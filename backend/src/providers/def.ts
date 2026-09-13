import type { ModelEvent, ModelProviderId } from 'chrome-tab-shared'
import type { SourceRole } from '../adjudication'

/** 档位同时是轮询间隔与健康新鲜度预算(ADR-0062)。 */
export const SOURCE_INTERVAL_MS: Record<SourceRole, number> = {
  release: 2 * 3600_000, catalog: 6 * 3600_000, retirement: 6 * 3600_000,
  pricing: 24 * 3600_000, limits: 24 * 3600_000, weights: 24 * 3600_000,
}

export const sourceIsStale = (role: SourceRole, status: { stale: number; last_success_at: string | null }): boolean =>
  status.stale === 1 || status.last_success_at === null ||
  Date.now() - Date.parse(status.last_success_at) > SOURCE_INTERVAL_MS[role]

/** 目录差集解析器(票 07):目录页 → 在册模型 ID 集(条目 = ID 本身)。 */
export type CatalogParse = (page: string) => ParseResult<string>

/** 退役公告条目(票 07):官方弃用/退役公告的条目级形态。 */
export interface RetirementEntry {
  /** YYYY-MM-DD(公告标注的下线/弃用日期;月份粒度信源锚定当月 1 日,同事件口径)。 */
  occurredOn: string
  /** 公告标题/原文行(线索 title;超长由 retirementClues 截断)。 */
  title: string
  /** 条目内结构性出现的模型 ID(反引号/表格列);标题里的别名命中由 retirementClues 补齐。 */
  modelIds: string[]
}

/** 退役页解析器(票 07)。零条目合法(当期无弃用公告),与目录页零条目判改版不同。 */
export type RetirementParse = (page: string) => ParseResult<RetirementEntry>

/**
 * 信源登记形态。`html: true` = 页面是 HTML(存储/指纹前须经 normalizeSourcePage 取正文);
 * 缺省 = .md 原样。**静态声明而非内容启发式**:启发式对「.md 正文里出现字面 `<meta>`」
 * 误报(存储形态被重写、指纹翻转)、对「无 `<html>` 字面标签的 HTML」漏报(script hash
 * 进指纹)——注册表自己知道每个 URL 是什么,不用猜。条目级语义只落在 catalog/retirement
 * 两角色(票 07:目录差集与退役监视);pricing/limits/weights 维持「注册 + 页指纹」形态
 * (票 06:轮询只为算指纹,变化经 shadow_rechecks 触发重核),parse 为函数即产线索,
 * 'fingerprint' 仅指纹(该角色信源页无条目可解析时的形态,如百炼下线页只有批次日期)。
 */
export type ProviderSources<E> = {
  release: { urls: string[]; parse: (md: string) => ParseResult<E>; html?: boolean }
  catalog: { urls: string[]; parse: CatalogParse | 'fingerprint'; html?: boolean }
  retirement: { urls: string[]; parse: RetirementParse | 'fingerprint'; html?: boolean }
} & Record<'pricing' | 'limits' | 'weights', { urls: string[]; parse: 'fingerprint'; html?: boolean }>

/**
 * 「跟踪厂家」的 provider 定义(CONTEXT.md「跟踪厂家」;ADR-0038):一个厂家与取数
 * 相关的全部差异——信源 URL、确定性解析器、单条目分派(命中为事件,未中为待核验
 * 线索)——打包为一份 ProviderDef;取数骨架(零条目判改版/循环收集/幂等入库/标陈旧/
 * 多页失败聚合)由 ModelTrackingService.runPoll 统一持有,不随厂家复制。
 */

/** 一条被基线认领的事件(officialId 指向基线行;入库时换 model_archive.id)。 */
export type MatchedHit = { officialId: string; event: Omit<ModelEvent, 'id'> }

/** 待核验线索(解析出但基线未认领的条目;ADR-0025「跳过待核验」的可见形态)。 */
export interface PendingClue {
  occurredOn: string
  title: string
  sourceUrl: string
  /** provider 内条目唯一键(文档链接/锚点/裸 ID 类恒定键;无结构化键时用
   *  `日期|标题` 派生——含 `|` 即派生键,消费方(如 openai verifyUrls 的模型文档页
   *  内插)以此判别不把它当模型 ID)。upsert 幂等去重。 */
  modelKey: string
}

/**
 * 单条目分派结果:命中 → 事件(家族式条目「Grok 4.20 and Grok 4.20 Multi-agent
 * are live」可多条);未认领 → 待核验线索是**默认**(整条未认领一条,或部分认领条目
 * 每个残余 ID 一条;键稳定优先——文档链接/锚点/裸 ID 类恒定键,无结构化键才用
 * 日期+文本派生)。空数组 = 不落线索:票 07 豁免取消后仅月暗文章流一处(文章非模型
 * 条目为主,该家线索由目录差集供);OpenAI 无 `Model:` 条目照常落线索。
 */
export interface MatchEntryResult {
  hits: MatchedHit[]
  clues: PendingClue[]
}

/**
 * 一个跟踪厂家的差异面。泛型 E 是该家解析后的条目形态;注册表以
 * ProviderDef<unknown> 存放(matchEntry 为方法语法,TS 方法双变使具体条目形态
 * 可存入),runPoll 经此擦除形态统一巡走。
 */
/**
 * 基线行集(runPoll 每轮从 model_archive 读出传给 matchEntry;ADR-0058 基线 DB 化后
 * 归属判定的输入不再绑定代码常量)。matchSlugs 仅智谱/Anthropic 双条件族消费。
 */
export interface BaselineRow {
  officialId: string
  matchAliases: readonly string[]
  matchSlugs: readonly string[]
}

export interface ProviderDef<E> {
  id: ModelProviderId
  /** 中文厂名家(cron 失败日志用,与既有日志格式对齐)。 */
  label: string
  /** 六类角色 → 地址与解析职责;非发布页只算指纹,事实裁决仍归核验图。 */
  sources: ProviderSources<E>
  /** 单条目分派(见 MatchEntryResult);rows = 该家基线行集(当轮从 DB 读)。 */
  matchEntry(e: E, rows: readonly BaselineRow[]): MatchEntryResult
  /** auto 核验信源(ADR-0058):线索 → 厂家一手页 URL(字段回链的「链」);缺省 =
   *  线索 sourceUrl 本身;undefined = 该家无线索自动核验(月暗文章流)。 */
  verifyUrls?: (clue: PendingClue) => string[]
  /** 确定性噪音谓词:命中不进 LLM(线索照常留表,红点可见;如百炼托管第三方前缀)。 */
  noiseClue?: (clue: PendingClue) => boolean
}

/**
 * parse 的返回:条目 + **意外跳过**片段(ADR-0052)。skipped 只计实抓口径之外的
 * 形态(畸形日期/错列/剥空标题),页面正常构成(**结构排除**:表头、非条目行、
 * 同 URL 重复卡)不计——空数组是全网常态基线,非空即上游漂移信号。
 */
export interface ParseResult<E> {
  entries: E[]
  /** 意外跳过片段(原始原文,clipFragment 截断;排障对回上游原页)。 */
  skipped: string[]
}

/** 意外跳过片段:截 80 字符,按码点切(Array.from 防代理对拦腰截断出孤立代理项)。
 *  片段内容各家取「排障关键可见」的形态:跳过点在块/行开头用原始原文,窗口开头是
 *  噪音标签的(通义表格行/智谱属性块)用已提取字段合成,关键字段前置(防截尾丢失)。 */
export const clipFragment = (raw: string): string => {
  const cps = Array.from(raw)
  return cps.length > 80 ? `${cps.slice(0, 80).join('')}…` : raw
}

/** 'YYYY-MM-DD' 是实日期(回滚校验,`2026-13-45`/`2026-02-30` 拒收)——月暗卡日期、
 *  DeepSeek 段日期与 normalizeIsoDate 的归一侧共用(单一实现防漂移)。归一复合体:
 *  数字未补零形态单点 normalizeIsoDate;Anthropic/xAI 的英文月份形态各异,不合并。 */
export const isRealIsoDate = (s: string): boolean => {
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

/** '2026-8-19' / '2026-06-16' → '2026-08-19' / '2026-06-16';非法 → null——智谱
 *  label 与百炼时间列共用(两上游实测产未补零形态,同源漂移不该在接入侧蒸发;
 *  2026-09-02 评审候选 2 收编逐字符同构对,回滚校验复合 isRealIsoDate 不另立)。 */
export function normalizeIsoDate(raw: string): string | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw.trim())
  if (!m) return null
  const [, y, mo, d] = m
  const iso = `${y}-${mo!.padStart(2, '0')}-${d!.padStart(2, '0')}`
  return isRealIsoDate(iso) ? iso : null
}

// ---- 匹配底座(多家共享的词边界/slug/ID 解析/月份判定;单一实现防两处漂移)----
//
// 认领优先级三策略(一条目命中多行基线时归谁;各族策略有存在理由,非通则):
// · 基线行序——双条件族(智谱/Anthropic):共公告条目归行序在前的主模型,是基线数据的
//   人工排布意图(住址:anthropicBaseline 注释 + modelTracking.test「共同公告」用例)
// · 最长 alias——标题族月暗:「Kimi K2 Thinking」同时命中「Kimi K2」与「Kimi K2
//   Thinking」取更长(标题无链接 slug 佐证,靠更具体的别名消歧)
// · 精确 + 最长前缀——结构化 ID 族(makeIdResolver):ID 前缀天然分层,快照归家族行

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
export function slugIn(slug: string, docUrl: string): boolean {
  const re = new RegExp(`${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w.-])`)
  return re.test(docUrl)
}

/**
 * 结构化 ID → 基线行解析器工厂(OpenAI `Model:` 字段与百炼 ID 列共用;2026-09-02
 * 评审候选 2 收编逐字符同构对):**精确 alias 命中优先返回**(「gpt-5.2-codex」归自己,
 * 不被「gpt-5.2」前缀认领);否则取最长 `id.startsWith(alias + '-')` 前缀命中——日期
 * 快照/变体归家族行;无命中 → null(残余 ID 线索走 residualIdClues)。
 */
export function makeIdResolver(
  baseline: ReadonlyArray<{ officialId: string; matchAliases: readonly string[] }>,
): (id: string) => string | null {
  return (id) => {
    let best: string | null = null
    let bestLen = -1
    for (const b of baseline) {
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
}

/**
 * 结构化 ID 列表的残余线索(ADR-0051):resolve 不认领且非 `-latest` 引用别名的
 * ID,逐个一条裸键线索(全未认领与部分认领同构——同一模型永不双行)。OpenAI 与
 * 通义发布流、目录差集(票 07)三处共用(单一实现防漂移;排除规则演进只改这里)。
 */
export function residualIdClues(
  ids: readonly string[],
  resolveId: (id: string) => string | null,
  base: { occurredOn: string; titleOf: (id: string) => string; sourceUrl: string },
): PendingClue[] {
  const residual = [...new Set(ids.filter((id) => resolveId(id) === null && !isReferenceAlias(id)))]
  return residual.map((id) => ({
    occurredOn: base.occurredOn,
    title: `${id}:${base.titleOf(id)}`,
    sourceUrl: base.sourceUrl,
    modelKey: id,
  }))
}

/** 残余 ID/目录差集的排除谓词:`-latest` 引用别名不另算模型(CONTEXT)。 */
export const isReferenceAlias = (id: string): boolean => id.endsWith('-latest')

// ---- 目录差集与退役监视(票 07:六类信源里需要条目级语义的两类)----

/**
 * 目录差集的归并解析器(票 07),**家族归并守卫**:键集 = officialId ∪ matchAliases
 * (官方 API 目录/百炼价格页以 officialId 为第一公民,月暗目录页只有 API ID 而 alias
 * 是展示名,缺 officialId 半边会把全目录误报成差集);精确命中优先,否则取最长
 * `id.startsWith(key + '-')` 前缀(日期快照/变体归家族行)——**仅认厂家明确关系**
 * (CONTEXT「模型」:名称相似或版本号相近不构成同一性),与发布流 makeIdResolver
 * 分立:发布归属仍以人工排布的 alias 集为准,差集多认 officialId 半边。
 */
export function makeCatalogResolver(
  rows: ReadonlyArray<{ officialId: string; matchAliases: readonly string[] }>,
): (id: string) => string | null {
  return (id) => {
    let best: string | null = null
    let bestLen = -1
    for (const b of rows) {
      for (const key of [b.officialId, ...b.matchAliases]) {
        if (key === id) return b.officialId
        if (id.startsWith(`${key}-`) && key.length > bestLen) {
          best = b.officialId
          bestLen = key.length
        }
      }
    }
    return best
  }
}

/**
 * 目录差集线索(票 07):目录在册而档案无认领的模型 ID → 待核验线索。目录在场是
 * availability 的必要非充分证据(裁决矩阵),新模型事实仍归核验链裁决,差集只负责
 * 「看见」。occurredOn = 观察日(目录页不携带模型日期;未裁决行随轮刷新,有裁决行
 * 由账本冻结不再续窗)。`-latest` 引用别名不算。
 */
export function catalogDiffClues(
  ids: readonly string[],
  rows: ReadonlyArray<{ officialId: string; matchAliases: readonly string[] }>,
  base: { occurredOn: string; sourceUrl: string },
): PendingClue[] {
  // 残余投影与发布流 residualIdClues 同构,直接委托(过滤/去重/`-latest` 排除单点)
  return residualIdClues(ids, makeCatalogResolver(rows), { ...base, titleOf: () => '官方目录在册' })
}

/**
 * 退役线索(票 07):官方弃用/退役公告条目 → 待核验线索,进同一核验协议(stage/retired_at
 * 由裁决矩阵只认 retirement 信源观察)。候选 ID = 条目结构 ID(反引号/表格列)∪ 标题
 * 词边界命中的基线别名(发布流式公告的型号在标题里,结构提不出来);`-latest` 不算;
 * 同 ID 多条目取首条(两家退役页均最新在前)。**页面消失不在此路径**——差集只做加法,
 * 出目录不是观察(ADR-0062 证据语义硬规),退役判定仍只认官方文字。
 */
export function retirementClues(
  entries: readonly RetirementEntry[],
  rows: readonly BaselineRow[],
  sourceUrl: string,
): PendingClue[] {
  const clues: PendingClue[] = []
  const seen = new Set<string>()
  for (const e of entries) {
    const candidates = new Set(e.modelIds)
    for (const b of rows) {
      for (const a of b.matchAliases) {
        if (aliasIn(a, e.title)) candidates.add(a)
      }
    }
    for (const id of candidates) {
      if (isReferenceAlias(id) || seen.has(id)) continue
      seen.add(id)
      clues.push({
        occurredOn: e.occurredOn,
        title: e.title.length > 160 ? `${e.title.slice(0, 157)}…` : e.title,
        sourceUrl,
        modelKey: id,
      })
    }
  }
  return clues
}

/** 发布流标题里的退役公告词面(票 07):词面是**召回闸**——误召回的代价是一条线索,
 *  事实精度归核验链对原文裁决;漏召回是接受的缺口(措辞不含词面的公告监视不到)。 */
const RETIRE_WORDS = /下线|停用|退役|弃用|deprecat|retir|sunset|discontinu/i

/** 发布流条目(日期+标题)→ 退役条目(标题词面过滤;深求/智谱/xAI 的退役信源即
 *  发布流本身,同一解析器复用,只换筛)。 */
export function retirementFromTitles(titles: ReadonlyArray<{ occurredOn: string; title: string }>): RetirementEntry[] {
  return titles.filter((t) => RETIRE_WORDS.test(t.title)).map((t) => ({ ...t, modelIds: [] }))
}

/**
 * 弃用公告段的表格模型列提取(OpenAI deprecations / Anthropic model-deprecations 共用,
 * 票 07):两家段落正文都是「首列日期、**次列模型**、末列推荐替代」的三列表
 * (`| Shutdown date | Model / system | Recommended replacement |`;平台功能段次列是
 * Update,天然无 ID)——只取次列反引号 ID,替代模型列不进退役监视。
 */
/**
 * `### YYYY-MM-DD: 标题` 弃用公告段解析(OpenAI deprecations 与 Anthropic
 * model-deprecations 两页同构,票 07;单一实现防两处漂移):逐段提取日期+标题,
 * 模型 ID = 段内表格次列(deprecationTableIds)∪ 标题反引号(chat-latest 快照段
 * 型号在标题);无日期段(平台公告/页首 Note)结构排除,日期形态但回滚校验失败
 * 落意外跳过。Anthropic「Model status」现状表是 `##` 级不进段切分(状态非公告)。
 */
export function datedSectionsToRetirements(md: string): ParseResult<RetirementEntry> {
  const out: RetirementEntry[] = []
  const skipped: string[] = []
  for (const part of md.split('\n### ').slice(1)) {
    const nl = part.indexOf('\n')
    const head = (nl === -1 ? part : part.slice(0, nl)).trim()
    const body = nl === -1 ? '' : part.slice(nl)
    const m = /^(\d{4}-\d{2}-\d{2}):\s*(.+)$/.exec(head)
    if (m === null) continue // 结构排除:无日期段(Reusable prompts 等平台公告)
    if (!isRealIsoDate(m[1]!)) {
      skipped.push(clipFragment(head)) // 意外跳过:日期形态但回滚校验失败
      continue
    }
    const ids = [...deprecationTableIds(body), ...[...head.matchAll(/`([^`]+)`/g)].map((x) => x[1]!)]
    out.push({ occurredOn: m[1]!, title: m[2]!.trim(), modelIds: ids })
  }
  return { entries: out, skipped }
}

export function deprecationTableIds(section: string): string[] {
  const ids: string[] = []
  let inModelTable = false
  for (const line of section.split('\n')) {
    if (!line.startsWith('|')) {
      inModelTable = false
      continue
    }
    const cells = line.split('|').slice(1, -1).map((c) => c.trim())
    if (cells.length < 2) continue
    if (!inModelTable) {
      // 表头行:次列是模型列(Model / system、Model family / snapshot、Deprecated model)
      inModelTable = /model/i.test(cells[1]!)
      continue
    }
    for (const m of cells[1]!.matchAll(/`([^`]+)`/g)) ids.push(m[1]!)
  }
  return ids
}

/** 英文月份名 → 两位数(Anthropic/xAI/OpenAI 三家日期归一共用)。 */
export const MONTHS: Record<string, string> = {
  January: '01', February: '02', March: '03', April: '04', May: '05', June: '06',
  July: '07', August: '08', September: '09', October: '10', November: '11', December: '12',
}
