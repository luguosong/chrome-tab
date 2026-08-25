import { schedule } from 'node-cron'
import { Hono } from 'hono'
import type {
  AvailabilityMode,
  ModelArchiveResponse,
  ModelEvent,
  ModelEventKind,
  ModelKind,
  ModelLimit,
  ModelPricing,
  ModelProviderId,
  ModelTrainingParams,
  ReleaseStage,
  TrackedModel,
} from 'chrome-tab-shared'
import { fetchText } from './common'
import type { Db } from './db'
import type { AuthEnv } from './auth'
import { ZHIPU_BASELINE } from './zhipuBaseline'
import { ANTHROPIC_BASELINE } from './anthropicBaseline'
import { XAI_BASELINE } from './xaiBaseline'
import { KIMI_BASELINE } from './kimiBaseline'
import { OPENAI_BASELINE, OPENAI_CHANGELOG_PAGE_URL, openaiChangelogAnchor } from './openaiBaseline'
import { DEEPSEEK_BASELINE, DEEPSEEK_UPDATES_URL, matchDeepSeekEvent, parseDeepSeekUpdates } from './deepseekBaseline'

/**
 * 模型追踪(CONTEXT.md「模型追踪/跟踪模型/模型档案」;ADR-0025):全局单例图标的
 * 后端档案。与「AI 热点」的易失代理相反、与「视频更新」同为持久化轮询,但**无
 * user_id**——档案对所有用户共享,单个信源失败保留最后成功结果并标记陈旧
 * (model_fetch_status,按厂家隔离)。三段分工(研究 §6):**档案行(基本资料)只来自
 * 代码内人工核验基线**,部署即幂等 upsert 刷新;**模型动态来自各厂家主发布源确定性
 * 解析**(智谱新品发布 Markdown 的 `<Update label description>` 块、Anthropic
 * release notes 的 `### 日期` 段内条目、xAI 发布流的 `## 月份`/`### 条目` 段——仅月
 * 份粒度、事件锚定当月 1 日、月之暗面资讯/Blog 的文章卡片(无 RSS,按文章 URL
 * 去重)、DeepSeek API Change Log 的 HTML `Date:` 段内 h3 小节、OpenAI API changelog
 * 的 `## 月份`/`### 日` 段内类型行(`Model:` 字段即结构化归属);按模型+类型+日期+信源去重);解析器
 * **不认识**的更新块(基线外型号,含智谱平台托管的第三方模型、Anthropic 仅限受邀
 * 项目的 Mythos 系列)只作待核验线索跳过——待基线人工核验后纳入,这是「跟踪厂家」
 * 的定义性约束(不开放任意厂家/信源配置,理由见 ADR-0025)。
 */

// ---- 纯函数(解析与匹配;模块级 seam,无 IO)----

/** 智谱发布页一个更新块(解析后的统一形态)。 */
export interface ZhipuUpdate {
  /** YYYY-MM-DD(信源不补零的 label 归一化后)。 */
  date: string
  /** 块描述(announcement 标题,如「GLM-5.3 新一代旗舰模型上线」)。 */
  description: string
  /** 块内首个模型文档链接(相对路径已归一为绝对);无链接 → null。 */
  docUrl: string | null
}

/** '2026-8-19' / '2026-06-16' → '2026-08-19' / '2026-06-16';非法 → null。 */
export function normalizeZhipuDate(raw: string): string | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw.trim())
  if (!m) return null
  const [, y, mo, d] = m
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)))
  if (date.getUTCMonth() !== Number(mo) - 1 || date.getUTCDate() !== Number(d)) return null
  return `${y}-${mo!.padStart(2, '0')}-${d!.padStart(2, '0')}`
}

/** 智谱新品发布 Markdown → 更新块数组。结构化 `<Update>` 块逐个提取 label/description/块内首个链接;
 *  双 lookahead 锚定两属性、**次序无关**(上游调整属性序不致静默清零);畸形块跳过。 */
export function parseZhipuReleases(md: string): ZhipuUpdate[] {
  const out: ZhipuUpdate[] = []
  const blockRe = /<Update\b(?=[^>]*label="([^"]*)")(?=[^>]*description="([^"]*)")[^>]*>([\s\S]*?)<\/Update>/g
  for (const m of md.matchAll(blockRe)) {
    const date = normalizeZhipuDate(m[1]!)
    if (!date) continue
    // 块内首个 markdown 链接([**名称**](路径));相对路径(/cn/…)归一到 docs.bigmodel.cn
    const link = /\[[^\]]*\]\(([^)\s]+)\)/.exec(m[3]!)?.[1]
    const docUrl = link
      ? link.startsWith('/')
        ? `https://docs.bigmodel.cn${link}`
        : link
      : null
    out.push({ date, description: m[2]!, docUrl })
  }
  return out
}

/** 人工核验基线模型(代码即配置;profile 字段部署时幂等刷新,事件不动)。 */
export interface BaselineModel {
  provider: ModelProviderId
  officialId: string
  name: string
  kind: ModelKind
  stage: ReleaseStage
  availability: AvailabilityMode[]
  summary: string | null
  sources: Array<{ title: string; url: string }>
  /** 官方定价;未核验到现价 → null。 */
  pricing: ModelPricing | null
  /** 官方限额(上下文/最大输出/输入大小等);未披露 → null。 */
  limits: ModelLimit[] | null
  /** 官方披露的训练参数量(MoE 总/激活分别记录);未披露 → null。 */
  trainingParams: ModelTrainingParams | null
  /**
   * 发布页块的归属判定:alias 词边界匹配是共用底座(「GLM-4.7」不认领「GLM-4.7-Flash」
   * 的块)。智谱/Anthropic 再加链接 slug 双条件(防上游张冠李戴——实测 GLM-Image 块误链
   * glm-4.7 文档页);xAI 只用标题 alias(条目标题即官方条目名,见 matchXaiEvent);
   * OpenAI 用 changelog 类型行的 `Model:` 字段精确/最长前缀匹配(结构化 ID,见
   * resolveOpenAIModelId),无需词边界。
   */
  matchAliases: string[]
  /** 智谱/Anthropic 双条件的链接半边(路径尾边界,「…/glm-4」不认领「…/glm-4-long」);xAI 行省略。 */
  matchSlugs?: string[]
  /** 人工核验的历史动态(官方发布页/弃用表口径);幂等入库,同键自动解析 'updated' 事件被其取代。 */
  events?: Array<Omit<ModelEvent, 'id'>>
}

export { ZHIPU_BASELINE, ANTHROPIC_BASELINE, XAI_BASELINE, KIMI_BASELINE, OPENAI_BASELINE, DEEPSEEK_BASELINE }

/** 全部厂家基线(init 幂等 upsert 的单一遍历源;新厂家票 = 基线文件 + 追加于此)。 */
const ALL_BASELINES: BaselineModel[] = [
  ...ZHIPU_BASELINE,
  ...ANTHROPIC_BASELINE,
  ...XAI_BASELINE,
  ...KIMI_BASELINE,
  ...OPENAI_BASELINE,
  ...DEEPSEEK_BASELINE,
]

// ---- Anthropic release notes 解析(研究 §3:主发布源;页面混有 SDK/平台功能条目,
//  须按明确模型名/ID 过滤——与智谱同用双条件归属)----

/** Anthropic release notes 一个条目(解析后的统一形态)。 */
export interface AnthropicNote {
  /** YYYY-MM-DD(日期标题归一化后,含 'October 3rd, 2024' 式序数后缀)。 */
  date: string
  /** 条目 Markdown 原文(链接文本/URL 一并保留,alias 在原文上词边界匹配)。 */
  text: string
  /** 条目内链接 URL(按出现序)。 */
  links: string[]
}

const MONTHS: Record<string, string> = {
  January: '01', February: '02', March: '03', April: '04', May: '05', June: '06',
  July: '07', August: '08', September: '09', October: '10', November: '11', December: '12',
}

/** 'August 5, 2026' / 'October 3rd, 2024' → '2026-08-05' / '2024-10-03';非法 → null。 */
export function normalizeAnthropicDate(raw: string): string | null {
  const m = /^([A-Z][a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,\s*(\d{4})$/.exec(raw.trim())
  if (!m) return null
  const [, mon, day, y] = m
  const mo = MONTHS[mon!]
  if (mo === undefined) return null
  const d = Number(day)
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, d))
  if (date.getUTCMonth() !== Number(mo) - 1 || date.getUTCDate() !== d) return null
  return `${y}-${mo}-${String(d).padStart(2, '0')}`
}

/** Anthropic release notes Markdown → 条目数组。按 `### 日期标题` 分段(段名即信源日期),
 *  段内行首 `* ` 逐条提取文本与 `[label](url)` 链接;畸形日期段与空段跳过。 */
export function parseAnthropicReleases(md: string): AnthropicNote[] {
  const out: AnthropicNote[] = []
  const headings = [...md.matchAll(/^### (.+)$/gm)]
  for (let i = 0; i < headings.length; i++) {
    const date = normalizeAnthropicDate(headings[i]![1]!)
    if (date === null) continue
    const body = md.slice(headings[i]!.index! + headings[i]![0].length, headings[i + 1]?.index)
    for (const line of body.split('\n')) {
      if (!line.startsWith('* ')) continue
      const text = line.slice(2)
      const links = [...text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)].map((m) => m[1]!)
      out.push({ date, text, links })
    }
  }
  return out
}

/** 条目标题:首个英文句子的截断形态(release notes 条目无短标题,首句即最接近的概述)。 */
function anthropicNoteTitle(text: string): string {
  const firstSentence = text.split('. ')[0]!
  return firstSentence.length > 160 ? `${firstSentence.slice(0, 157)}…` : firstSentence
}

/**
 * release notes 条目 → (基线模型 officialId, 事件)。双条件归属与智谱同构:条目原文含
 * 基线 alias(词边界;「Claude Opus 4」不认领「Claude Opus 4.8」的条目)**且** 条目内
 * 存在链接命中基线 slug(路径尾边界)——SDK/平台功能条目与基线外型号(Mythos 等)因此
 * 天然跳过。kind 恒 'updated',与基线事件同 (模型,日期,信源) 的条目由 poll 跳过。
 */
export function matchAnthropicEvent(n: AnthropicNote): { officialId: string; event: Omit<ModelEvent, 'id'> } | null {
  for (const b of ANTHROPIC_BASELINE) {
    const aliasHit = b.matchAliases.some((a) => aliasIn(a, n.text))
    const link = n.links.find((u) => (b.matchSlugs ?? []).some((s) => slugIn(s, u)))
    if (aliasHit && link) {
      return {
        officialId: b.officialId,
        event: { kind: 'updated', occurredOn: n.date, title: anthropicNoteTitle(n.text), sourceUrl: link },
      }
    }
  }
  return null
}

// ---- xAI 发布流解析(研究 §3:主发布源;`## 月份` 标题仅月份粒度,条目 `### ` 自带标题)----

/** xAI 发布流一个条目(解析后的统一形态)。 */
export interface XaiReleaseEntry {
  /** YYYY-MM(信源只有月份粒度;事件锚定当月 1 日)。 */
  yearMonth: string
  /** 条目标题(`### ` 行原文,即官方条目名——归属匹配只用标题,见 matchXaiEvent)。 */
  title: string
  /** 正文首个链接(相对路径已归一为绝对);无 → null。 */
  linkUrl: string | null
}

/**
 * xAI 发布流 Markdown → 条目数组。`## <Month>[ <YYYY>]` 月份标题分段、段内 `### ` 条目
 * 逐个提取标题与正文首个链接。当年月份标题**不带年份**(2026-08-25 实抓口径),首个带
 * 年份标题之前按 currentYear(生产传当年,测试传固定值保持确定性)、其后依显式年份。
 * 非月份 `##` 段下的条目跳过;月份段之前的散条目跳过。
 */
export function parseXaiReleaseNotes(md: string, currentYear: number = new Date().getFullYear()): XaiReleaseEntry[] {
  const out: XaiReleaseEntry[] = []
  let year: number | null = null
  let yearMonth: string | null = null
  let title: string | null = null
  let body: string[] = []
  const flush = () => {
    if (yearMonth !== null && title !== null) {
      const link = /\[[^\]]*\]\(([^)\s]+)\)/.exec(body.join('\n'))?.[1]
      out.push({
        yearMonth,
        title,
        linkUrl: link ? (link.startsWith('/') ? `https://docs.x.ai${link}` : link) : null,
      })
    }
    title = null
    body = []
  }
  for (const line of md.split('\n')) {
    const month = /^## ([A-Z][a-z]+)(?: (\d{4}))?$/.exec(line)
    if (month) {
      flush()
      const mo = MONTHS[month[1]!]
      if (mo === undefined) {
        yearMonth = null
        continue
      }
      if (month[2] !== undefined) year = Number(month[2])
      yearMonth = `${year ?? currentYear}-${mo}`
      continue
    }
    if (line.startsWith('### ')) {
      flush()
      title = line.slice(4).trim()
      continue
    }
    if (title !== null) body.push(line)
  }
  flush()
  return out
}

/**
 * 发布流条目 → 基线模型命中数组(**可为多个**:家族条目「Grok 4.20 and Grok 4.20
 * Multi-agent are live」同时命中两行)。归属只用标题词边界——xAI 条目标题即官方条目
 * 名、自证归属,与智谱/Anthropic 的双条件不同(其正文链接常指向能力文档而非模型页,
 * 不能作 slug 证据)。kind 恒 'updated',occurredOn 锚定当月 1 日(信源月份粒度);
 * 与基线事件同 (模型,日期,信源) 的条目由 poll 跳过。
 */
export function matchXaiEvent(e: XaiReleaseEntry): Array<{ officialId: string; event: Omit<ModelEvent, 'id'> }> {
  const out: Array<{ officialId: string; event: Omit<ModelEvent, 'id'> }> = []
  for (const b of XAI_BASELINE) {
    if (!b.matchAliases.some((a) => aliasIn(a, e.title))) continue
    out.push({
      officialId: b.officialId,
      event: { kind: 'updated', occurredOn: `${e.yearMonth}-01`, title: e.title, sourceUrl: e.linkUrl ?? XAI_RELEASES_URL },
    })
  }
  return out
}

// ---- 月之暗面资讯/Blog 解析(研究 §3:商业模型用资讯、研究/开放权重用 Blog,两页
//  均无文档化 RSS——按文章 URL 去重,研究 §6.6;页面为同构 Next.js 卡片列表)----

/** 月之暗面资讯/Blog 一篇文章卡片(解析后的统一形态)。 */
export interface KimiArticle {
  /** 绝对 URL(相对链接归一到 www.kimi.com;研究口径:按文章 URL 去重)。 */
  url: string
  /** 官方文章标题(卡片锚 aria-label,即 card-title 原文)。 */
  title: string
  /** YYYY-MM-DD(卡片日期文本,页面统一 ISO 格式)。 */
  date: string
}

/**
 * 资讯/Blog 页 HTML → 文章卡片数组。覆盖整卡的锚点(`<a href aria-label
 * class="absolute inset-0…">`)到下一锚点之间为一个卡片窗口:标题取锚点
 * aria-label,日期取 card-title **之后**的首个 ISO 日期文本——不能取窗口内首个
 * 日期,卡片头图 URL 常含与发布日不同的上传日期(实测 08-11 上传的头图配 07-27
 * 文章)。无日期卡跳过;同 URL 卡(头图卡与列表卡重复)只留首个;锚点缺失
 * (上游改版)自然产零卡 → pollOne 上游改版口径。
 */
export function parseKimiArticles(html: string): KimiArticle[] {
  const out: KimiArticle[] = []
  const seen = new Set<string>()
  const anchors = [
    ...html.matchAll(/<a href="([^"]+)" aria-label="([^"]+)" class="absolute inset-0[^"]*"/g),
  ]
  for (let i = 0; i < anchors.length; i++) {
    const [, href, label] = anchors[i]!
    const end = anchors[i + 1]?.index
    const cardWindow = html.slice(anchors[i]!.index! + anchors[i]![0].length, end)
    const titlePos = cardWindow.indexOf('card-title')
    if (titlePos < 0) continue
    const date = /20\d{2}-\d{2}-\d{2}/.exec(cardWindow.slice(titlePos))?.[0]
    if (date === undefined) continue
    const url = href!.startsWith('/') ? `https://www.kimi.com${href}` : href!
    if (seen.has(url)) continue
    seen.add(url)
    out.push({ url, title: label!, date })
  }
  return out
}

/**
 * 资讯/Blog 文章 → (基线模型 officialId, 事件)。归属只用标题词边界(文章标题即
 * 官方标题、自证归属,同 xAI 口径——正文链接常指向 GitHub/外部仓,不能作 slug
 * 证据)。**最长 alias 优先**:「Kimi K2 Thinking」标题同时命中「Kimi K2」与
 * 「Kimi K2 Thinking」,取更长(更具体)的归属。kind 恒 'updated',与基线事件同
 * (模型,日期,信源) 的文章由 poll 跳过——基线事件的信源即官方文章 URL。
 */
export function matchKimiEvent(a: KimiArticle): { officialId: string; event: Omit<ModelEvent, 'id'> } | null {
  let best: { officialId: string; alias: string } | null = null
  for (const b of KIMI_BASELINE) {
    for (const alias of b.matchAliases) {
      if (aliasIn(alias, a.title) && (best === null || alias.length > best.alias.length)) {
        best = { officialId: b.officialId, alias }
      }
    }
  }
  if (best === null) return null
  return {
    officialId: best.officialId,
    event: { kind: 'updated', occurredOn: a.date, title: a.title, sourceUrl: a.url },
  }
}

/**
 * alias 词边界命中:前不得是 [A-Za-z0-9_.-];后不得是标识符延续(单词字符、连字符,
 * 或「.」后跟单词字符——版本号下一段)。「4.8.」这类英文句尾句点不算延续(Anthropic
 * 条目为英文句子,「Claude Opus 4.8. See…」须命中);中文不算边界内字符。
 */
export function aliasIn(alias: string, description: string): boolean {
  const re = new RegExp(`(?<![\\w.-])${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-]|\\.\\w)`)
  return re.test(description)
}

/** slug 路径命中且尾部带边界(「…/glm-4」不认领「…/glm-4-long」「…/glm-4.x」)。 */
function slugIn(slug: string, docUrl: string): boolean {
  const re = new RegExp(`${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w.-])`)
  return re.test(docUrl)
}

/** 公告去重键(模型+日期+信源;init 取代删除与 poll 跳过共用,防两处拼串漂移)。 */
const eventKey = (modelId: number, occurredOn: string, sourceUrl: string) =>
  `${modelId}|${occurredOn}|${sourceUrl}`

/** Array.filter 的非空收窄便利(matchXxxEvent 可能返回 null——基线外/双条件不满足)。 */
function nonNull<T>(x: T | null): x is T {
  return x !== null
}

/**
 * 更新块 → (基线模型 officialId, 事件)。仅双条件匹配的块产事件,kind 恒 'updated'
 * (自动解析不猜语义化事件类型;api_available 等语义类型只出自人工核验基线 events)。
 * 与基线事件同 (模型,日期,信源) 的块由 pollZhipu 跳过,不产重复动态。
 */
export function matchZhipuEvent(u: ZhipuUpdate): { officialId: string; event: Omit<ModelEvent, 'id'> } | null {
  const docUrl = u.docUrl
  if (docUrl === null) return null // 无链接无法核验归属 → 待核验线索,不生成动态
  for (const b of ZHIPU_BASELINE) {
    const aliasHit = b.matchAliases.some((a) => aliasIn(a, u.description))
    const slugHit = (b.matchSlugs ?? []).some((s) => slugIn(s, docUrl))
    if (aliasHit && slugHit) {
      const event: Omit<ModelEvent, 'id'> = {
        kind: 'updated',
        occurredOn: u.date,
        title: u.description,
        sourceUrl: docUrl,
      }
      return { officialId: b.officialId, event }
    }
  }
  return null
}

// ---- OpenAI API changelog 解析(研究 §3:主发布源。与别家不同,条目类型行自带
//  `Model: id` 结构化字段,归属无需双条件猜测——精确 ID 匹配 + 最长前缀快照归族)----

/** OpenAI API changelog(主发布源;.md 形式直抓,锚点用人类可读页 URL——基址出自 openaiBaseline 单一事实源)。 */
export const OPENAI_CHANGELOG_URL = `${OPENAI_CHANGELOG_PAGE_URL}.md`

/** changelog 一个条目(解析后的统一形态)。 */
export interface OpenAIChangelogEntry {
  /** YYYY-MM-DD(`## Month, YYYY` 月标题与 `### Mon DD` 日标题两级合成)。 */
  date: string
  /** 条目类型行原文(Feature/Update/Announcement/Fix…)。 */
  typeLine: string
  /** 类型行声明的模型 ID(changelog 用精确 API ID,含日期快照与移动别名)。 */
  models: string[]
  /** 正文首行(自动解析事件的标题;无正文 → 空串)。 */
  firstLine: string
}

/** changelog Markdown → 条目数组。月标题定年月、日标题定日;类型行(Feature/Update/…
 *  开头)起一条,正文首行为标题;无日期上下文或畸形日期下的条目跳过;不认识的
 *  `##`/`###` 标题保守清空日期上下文(实测 156 个日标题全部规整,此分支为防线)。 */
export function parseOpenAIChangelog(md: string): OpenAIChangelogEntry[] {
  const out: OpenAIChangelogEntry[] = []
  let year: string | null = null
  let month: string | null = null
  let day: string | null = null
  let entry: OpenAIChangelogEntry | null = null
  const flush = () => {
    if (entry !== null) out.push(entry)
    entry = null
  }
  for (const line of md.split('\n')) {
    if (line.startsWith('## ')) {
      flush()
      const monthHeading = /^## ([A-Z][a-z]+), (\d{4})\s*$/.exec(line)
      year = monthHeading?.[2] ?? null
      month = (monthHeading !== null ? MONTHS[monthHeading[1]!] : null) ?? null
      day = null
      continue
    }
    if (line.startsWith('### ')) {
      flush()
      const dayHeading = /^### ([A-Z][a-z]{2}) (\d{1,2})\s*$/.exec(line)
      const d = dayHeading !== null ? Number(dayHeading[2]) : NaN
      day = month !== null && d >= 1 && d <= 31 ? String(d).padStart(2, '0') : null
      continue
    }
    if (/^(Feature|Update|Announcement|Fix|Deprecation|Breaking change)\b/.test(line)) {
      if (year !== null && month !== null && day !== null) {
        flush()
        entry = {
          date: `${year}-${month}-${day}`,
          typeLine: line.trim(),
          models: [...line.matchAll(/Model: ([a-zA-Z0-9._-]+)/g)].map((m) => m[1]!),
          firstLine: '',
        }
      }
      continue
    }
    if (entry !== null && entry.firstLine === '' && line.trim() !== '') entry.firstLine = line.trim()
  }
  flush()
  return out
}

/**
 * 条目模型 ID → 基线 officialId。**精确 alias 命中优先返回**(「gpt-5.2-codex」归自己,
 * 不被「gpt-5.2」前缀认领);否则取最长 `id.startsWith(alias + '-')` 前缀命中——日期
 * 快照(gpt-image-2-2026-04-21、gpt-4o-mini-transcribe-2025-12-15)归家族行;移动别名
 * (chat-latest、daybreak-*-latest、gpt-5.x-chat-latest)不在基线,天然返回 null。
 */
export function resolveOpenAIModelId(id: string): string | null {
  let best: string | null = null
  let bestLen = -1
  for (const b of OPENAI_BASELINE) {
    for (const a of b.matchAliases) {
      if (a === id) return b.officialId
      if (id.startsWith(`${a}-`) && a.length > bestLen) {
        best = b.officialId
        bestLen = a.length
      }
    }
  }
  return best
}

/** 条目标题:正文首行,超长截断(changelog 无短标题,首句即最接近的概述)。 */
function openaiEntryTitle(firstLine: string): string {
  return firstLine.length > 160 ? `${firstLine.slice(0, 157)}…` : firstLine
}

/**
 * changelog 条目 → 每个被认领模型一条事件(kind 恒 'updated',自动解析不猜语义;
 * 同条目多个 ID 命中同一行只产一条)。与基线事件同 (模型,日期,锚点) 的条目由
 * poll 跳过——基线 api_available 等语义事件在库时不补 'updated' 重复行。
 * ponytail: 锚点为日粒度,同日同模型两条公告会撞去重键只留一条(实测 changelog
 * 同日多公告均为不同模型/无模型条目;若上游出现同日同模型双公告,再升条目序号锚)。
 */
export function matchOpenAIEvents(
  entries: OpenAIChangelogEntry[],
): Array<{ officialId: string; event: Omit<ModelEvent, 'id'> }> {
  const out: Array<{ officialId: string; event: Omit<ModelEvent, 'id'> }> = []
  for (const e of entries) {
    if (e.models.length === 0) continue
    const anchor = openaiChangelogAnchor(e.date)
    const claimed = new Set<string>()
    for (const id of e.models) {
      const officialId = resolveOpenAIModelId(id)
      if (officialId === null || claimed.has(officialId)) continue
      claimed.add(officialId)
      out.push({
        officialId,
        event: {
          kind: 'updated',
          occurredOn: e.date,
          title: openaiEntryTitle(e.firstLine !== '' ? e.firstLine : e.typeLine),
          sourceUrl: anchor,
        },
      })
    }
  }
  return out
}

// ---- 服务(档案读写 + 轮询;IO 经 ModelTrackingDeps 注入,测试零真网)----

export interface ModelTrackingDeps {
  fetchText: (url: string, timeoutMs: number) => Promise<string>
}

/** 智谱新品发布页(主发布源,研究 §3)。 */
export const ZHIPU_RELEASES_URL = 'https://docs.bigmodel.cn/cn/update/new-releases.md'
/** Anthropic Claude Platform release notes(主发布源,研究 §3)。 */
export const ANTHROPIC_RELEASES_URL = 'https://platform.claude.com/docs/en/release-notes/overview.md'
/** xAI 发布流(主发布源,研究 §3;公共缓存约 1 小时,轮询节奏 6h 不短于缓存)。 */
export const XAI_RELEASES_URL = 'https://docs.x.ai/developers/release-notes.md'
/** 月之暗面资讯(商业模型发布,研究 §3;无文档化 RSS,按文章 URL 去重)。 */
export const KIMI_NEWS_URL = 'https://www.kimi.com/news'
/** 月之暗面 Blog(研究/开放权重发布,研究 §3;同上按文章 URL 去重)。 */
export const KIMI_BLOG_URL = 'https://www.kimi.com/en/blog/'

const nowIso = () => new Date().toISOString()

export class ModelTrackingService {
  constructor(
    private readonly db: Db,
    private readonly deps: ModelTrackingDeps,
  ) {}

  /**
   * 启动初始化:基线幂等 upsert(profile 字段以代码为准刷新,含定价/限额/参数量)+
   * 基线事件入库(同键既有的自动解析 'updated' 事件被人工核验语义取代——同一公告
   * 不留两条动态;issues/01 时期入库的旧 'updated' 行由此清理)+ 首轮取数(不阻塞
   * 启动,失败照陈旧口径降级——基线数据已在库,tile 即有内容)。
   */
  async init(): Promise<void> {
    for (const b of ALL_BASELINES) {
      // profile 字段一处定义,insert 与 upsert 更新共用(新增字段只改这里)
      const profile = {
        name: b.name,
        kind: b.kind,
        stage: b.stage,
        availability: JSON.stringify(b.availability),
        summary: b.summary,
        sources: JSON.stringify(b.sources),
        pricing: b.pricing === null ? null : JSON.stringify(b.pricing),
        limits: b.limits === null ? null : JSON.stringify(b.limits),
        training_params: b.trainingParams === null ? null : JSON.stringify(b.trainingParams),
      }
      const { id: modelId } = await this.db
        .insertInto('model_archive')
        .values({
          provider: b.provider,
          official_id: b.officialId,
          ...profile,
          created_at: nowIso(),
          updated_at: nowIso(),
        })
        .onConflict((oc) =>
          oc
            .columns(['provider', 'official_id'])
            .doUpdateSet({ ...profile, updated_at: nowIso() }),
        )
        .returning('id')
        .executeTakeFirstOrThrow()
      for (const ev of b.events ?? []) {
        // 同 (模型,日期,信源) 的自动解析 'updated' 事件 → 删(被本条语义化事件取代)
        await this.db
          .deleteFrom('model_events')
          .where('model_id', '=', modelId)
          .where('kind', '=', 'updated')
          .where('occurred_on', '=', ev.occurredOn)
          .where('source_url', '=', ev.sourceUrl)
          .execute()
        await this.db
          .insertInto('model_events')
          .values({
            model_id: modelId,
            kind: ev.kind,
            occurred_on: ev.occurredOn,
            title: ev.title,
            source_url: ev.sourceUrl,
            created_at: nowIso(),
          })
          .onConflict((oc) =>
            oc
              .columns(['model_id', 'kind', 'occurred_on', 'source_url'])
              .doNothing(),
          )
          .execute()
      }
    }
    this.pollQuietly()
  }

  /** 档案读侧(路由直调):模型(可用在前、retired 沉底)+ 各事件倒序 + 信源状态。 */
  async archive(): Promise<ModelArchiveResponse> {
    const models = await this.db
      .selectFrom('model_archive')
      .selectAll()
      .orderBy((eb) => eb.case().when('stage', '=', 'retired').then(1).else(0).end(), 'asc')
      .orderBy('id', 'asc')
      .execute()
    const events = await this.db
      .selectFrom('model_events')
      .selectAll()
      .orderBy('occurred_on', 'desc')
      .orderBy('id', 'desc')
      .execute()
    const byModel = new Map<number, ModelEvent[]>()
    for (const e of events) {
      const list = byModel.get(e.model_id) ?? []
      list.push({
        id: e.id,
        kind: e.kind as ModelEventKind,
        occurredOn: e.occurred_on,
        title: e.title,
        sourceUrl: e.source_url,
      })
      byModel.set(e.model_id, list)
    }
    const sources = await this.db.selectFrom('model_fetch_status').selectAll().execute()
    return {
      models: models.map((r) => ({
        id: r.id,
        provider: r.provider as ModelProviderId,
        officialId: r.official_id,
        name: r.name,
        kind: r.kind as ModelKind,
        stage: r.stage as ReleaseStage,
        availability: JSON.parse(r.availability) as AvailabilityMode[],
        summary: r.summary ?? null,
        sources: JSON.parse(r.sources) as TrackedModel['sources'],
        pricing: r.pricing === null ? null : (JSON.parse(r.pricing) as TrackedModel['pricing']),
        limits: r.limits === null ? null : (JSON.parse(r.limits) as TrackedModel['limits']),
        trainingParams: r.training_params === null ? null : (JSON.parse(r.training_params) as TrackedModel['trainingParams']),
        events: byModel.get(r.id) ?? [],
      })),
      sources: sources.map((s) => ({
        provider: s.provider as ModelProviderId,
        stale: s.stale === 1,
        lastSuccessAt: s.last_success_at ?? null,
      })),
    }
  }

  /** cron 入口:失败只记日志(6h 节奏即天然重试,禁密集重试,同 videoUpdates 口径);
   *  各厂家独立 catch——单家失败不影响另一家本轮取数。 */
  pollQuietly(): void {
    void this.pollZhipu().catch((e) => console.error('模型追踪(智谱)取数失败:', e))
    void this.pollAnthropic().catch((e) => console.error('模型追踪(Anthropic)取数失败:', e))
    void this.pollXai().catch((e) => console.error('模型追踪(xAI)取数失败:', e))
    void this.pollMoonshot().catch((e) => console.error('模型追踪(月之暗面)取数失败:', e))
    void this.pollOpenAI().catch((e) => console.error('模型追踪(OpenAI)取数失败:', e))
    void this.pollDeepSeek().catch((e) => console.error('模型追踪(DeepSeek)取数失败:', e))
  }

  /** DeepSeek 一轮:Change Log HTML 日期段 h3 小节 → 标题匹配基线(解析器/匹配器随
   *  基线收在 deepseekBaseline.ts;匹配器可为多命中,flatMap 展开;零小节 = 上游改版)。 */
  async pollDeepSeek(): Promise<void> {
    await this.pollOne('deepseek', DEEPSEEK_UPDATES_URL, (html) => {
      const sections = parseDeepSeekUpdates(html)
      return sections.length === 0 ? null : sections.flatMap(matchDeepSeekEvent)
    })
  }

  /**
   * 匹配后的事件幂等入库(两家 poll 共用):去重键 = UNIQUE(model_id,kind,occurred_on,
   * source_url),研究 §6.6。已有**任意类型**事件占住同 (模型,日期,信源) 的公告跳过
   * ——人工核验基线事件(api_available 等)在库时,自动解析不再为同一公告补 'updated'
   * 重复行。
   */
  private async ingest(
    provider: ModelProviderId,
    hits: Array<{ officialId: string; event: Omit<ModelEvent, 'id'> }>,
  ): Promise<void> {
    const archive = await this.db
      .selectFrom('model_archive')
      .select(['id', 'official_id'])
      .where('provider', '=', provider)
      .execute()
    const idOf = new Map(archive.map((r) => [r.official_id, r.id]))
    // 已入库公告键(模型+日期+信源,类型无关)——基线事件已覆盖的不再自动入库
    const existing = await this.db
      .selectFrom('model_events')
      .select(['model_id', 'occurred_on', 'source_url'])
      .execute()
    const seen = new Set(existing.map((e) => eventKey(e.model_id, e.occurred_on, e.source_url)))
    for (const hit of hits) {
      const modelId = idOf.get(hit.officialId)
      if (modelId === undefined) continue
      if (seen.has(eventKey(modelId, hit.event.occurredOn, hit.event.sourceUrl))) continue
      await this.db
        .insertInto('model_events')
        .values({
          model_id: modelId,
          kind: hit.event.kind,
          occurred_on: hit.event.occurredOn,
          title: hit.event.title,
          source_url: hit.event.sourceUrl,
          created_at: nowIso(),
        })
        .onConflict((oc) =>
          oc
            .columns(['model_id', 'kind', 'occurred_on', 'source_url'])
            .doNothing(),
        )
        .execute()
    }
  }

  /**
   * 一轮取数的公共失败口径(fetch 抛错与「200 但零结构化条目」= 上游改版,均抛错标
   * 陈旧、保留库内最后成功结果,不静默清零;markSource 自身失败不吞原始错误——极端:
   * DB 写挂,原始信源错误更值得上抛/记日志)。结构差异(解析器/匹配器)由调用方闭合,
   * 返回 null 即「解析不出任何结构化条目」。
   */
  private async pollOne(
    provider: ModelProviderId,
    url: string,
    parseAndMatch: (md: string) => Array<{ officialId: string; event: Omit<ModelEvent, 'id'> }> | null,
  ): Promise<void> {
    try {
      const md = await this.deps.fetchText(url, 30_000)
      const hits = parseAndMatch(md)
      if (hits === null) throw new Error('发布源无结构化条目(疑似上游改版)')
      await this.ingest(provider, hits)
      await this.markSource(provider, true)
    } catch (e) {
      await this.markSource(provider, false).catch(() => {})
      throw e
    }
  }

  /** 智谱一轮:发布页 `<Update>` 块 → 双条件匹配基线(零块 = 上游改版,同 pollOne 口径)。 */
  async pollZhipu(): Promise<void> {
    await this.pollOne('zhipu', ZHIPU_RELEASES_URL, (md) => {
      const updates = parseZhipuReleases(md)
      return updates.length === 0
        ? null
        : updates.map(matchZhipuEvent).filter(nonNull)
    })
  }

  /** Anthropic 一轮:release notes `### 日期` 段条目 → 双条件匹配基线(零段 = 上游改版)。 */
  async pollAnthropic(): Promise<void> {
    await this.pollOne('anthropic', ANTHROPIC_RELEASES_URL, (md) => {
      const notes = parseAnthropicReleases(md)
      return notes.length === 0
        ? null
        : notes.map(matchAnthropicEvent).filter(nonNull)
    })
  }

  /** xAI 一轮:发布流 `## 月份`/`### 条目` → 标题匹配基线(零条目 = 上游改版)。 */
  async pollXai(): Promise<void> {
    await this.pollOne('xai', XAI_RELEASES_URL, (md) => {
      const entries = parseXaiReleaseNotes(md)
      return entries.length === 0 ? null : entries.flatMap(matchXaiEvent)
    })
  }

  /** OpenAI 一轮:changelog 类型行 `Model:` 字段精确/前缀匹配基线(零条目 = 上游改版)。 */
  async pollOpenAI(): Promise<void> {
    await this.pollOne('openai', OPENAI_CHANGELOG_URL, (md) => {
      const entries = parseOpenAIChangelog(md)
      return entries.length === 0 ? null : matchOpenAIEvents(entries)
    })
  }

  /**
   * 月之暗面一轮:资讯 + Blog 两页独立取数(研究 §3)。两页都尝试——单页失败上抛首个
   * 错误,另一页照常入库(单页失败不清空该页既有动态);两页各自的「零卡片 = 上游
   * 改版」口径由 pollOne 统一处理。**任一页失败即标陈旧**:pollOne 按页标记,后一页
   * 的成功会覆盖前一页的失败标记,故循环后统一补压终态(失败优先),再上抛。
   */
  async pollMoonshot(): Promise<void> {
    const errs: unknown[] = []
    for (const url of [KIMI_NEWS_URL, KIMI_BLOG_URL]) {
      try {
        await this.pollOne('moonshot', url, (html) => {
          const articles = parseKimiArticles(html)
          return articles.length === 0 ? null : articles.map(matchKimiEvent).filter(nonNull)
        })
      } catch (e) {
        errs.push(e)
      }
    }
    if (errs.length > 0) {
      await this.markSource('moonshot', false).catch(() => {})
      throw errs[0]
    }
  }

  private async markSource(provider: ModelProviderId, ok: boolean): Promise<void> {
    const now = nowIso()
    await this.db
      .insertInto('model_fetch_status')
      .values({
        provider,
        stale: ok ? 0 : 1,
        last_success_at: ok ? now : null,
        last_attempt_at: now,
      })
      .onConflict((oc) =>
        oc.column('provider').doUpdateSet({
          stale: ok ? 0 : 1,
          ...(ok ? { last_success_at: now } : {}),
          last_attempt_at: now,
        }),
      )
      .execute()
  }
}

// ---- HTTP 路由 ----

export function modelTrackingRoutes(service: ModelTrackingService): Hono<AuthEnv> {
  return new Hono<AuthEnv>().get('/api/model-tracking/archive', async (c) =>
    c.json(await service.archive()),
  )
}

// ---- 生产协作器(同 prodVideoDeps 范式:测试注入假 deps,生产装配显式)----

export function prodModelDeps(): ModelTrackingDeps {
  return { fetchText }
}

// ---- 定时轮询(研究 §6:6h 节奏;非整点错开,同 videoUpdates 口径)----

export function startModelTrackingScheduler(service: ModelTrackingService): void {
  schedule('41 */6 * * *', () => service.pollQuietly())
}
