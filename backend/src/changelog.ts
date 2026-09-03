import { schedule } from 'node-cron'
import * as cheerio from 'cheerio'
import { Hono, type Context } from 'hono'
import {
  DEFAULT_CHANGELOG_SOURCE,
  getChangelogSource,
  isPrereleaseVersion,
  type ChangelogSourceId,
} from 'chrome-tab-shared'
import type { Db } from './db'
import type { AuthEnv } from './auth'
import { fetchText, jsonBody } from './common'
import { makeBlockTranslator, makeTranslationStore, type TranslationStore } from './translate'

/**
 * 更新日志译制代理(ADR-0005/0016/0017,语义照搬 Java changelog 模块;多源化见 ADR-0020)。
 * 请求路径纯读内存快照(原子换新,零外呼零 LLM);node-cron 每 6h 预取刷新;
 * 启动先 loadFromDb 从快照表恢复(秒级可服务)再异步预热,失败沿用旧快照并重试(见 refreshQuietly)。
 * 译文按版本块原文 SHA-256 主键持久化,一版终身只译一次;增量检测纯算法零 token;
 * 块哈希与源无关——同原文块跨源共享译文,译文表无需源维度;
 * 译制失败记 warn 保持英文、下轮重试;refresh 与 translateVersions 互斥防并发重复译制。
 * 每源一个 Service 实例(source 参数),快照表 changelog_snapshots 按源一行。
 */

// ---- 切片器(Java ChangelogSlicer)----

export interface Block {
  /** 版本号(如 2.0.14),规则与前端 parseChangelog 的 h[1].trim() 对齐 */
  title: string
  /** 含标题行的整块原文——块边界即哈希边界,错一字符即失配 */
  raw: string
}

export interface Blocks {
  prefix: string
  blocks: Block[]
}

/** 行首 `## `(两井号+空白)起一个版本块;`### ` 三级标题归入所属版本块。 */
export function splitBlocks(markdown: string): Blocks {
  const starts: number[] = []
  for (const m of markdown.matchAll(/^##\s/gm)) starts.push(m.index)
  if (starts.length === 0) return { prefix: markdown, blocks: [] } // 无版本标题:整篇作前缀
  const blocks: Block[] = []
  for (let i = 0; i < starts.length; i++) {
    const end = i + 1 < starts.length ? starts[i + 1]! : markdown.length
    const raw = markdown.slice(starts[i], end)
    const heading = raw.split('\n', 1)[0]!
    blocks.push({ title: heading.replace(/^##\s*/, '').trim(), raw })
  }
  return { prefix: markdown.slice(0, starts[0]), blocks }
}

/** 块是否含标题行以外的内容:合成源的预发布占位块(仅 `## x.y.z` 一行)无可译内容,
 *  译窗口与按需补译都跳过(ADR-0050)。 */
const hasEntries = (b: Block): boolean => b.raw.split('\n').slice(1).some((l) => l.trim())

/** 无原文源(两地址皆缺省,ADR-0050 后无实例、类别保留)的版本流合成:npm time 表 →
 *  每版本一行 `## ` 标题空块的 markdown,下游 splitBlocks / 前端 parseChangelog 照常切出
 *  版本列表(块内无条目、也无从译制)。剔 created/modified 元键与 prerelease(shared 的
 *  isPrereleaseVersion 同源判断);npm time 值为等长 ISO 串,字典序即时间序,倒排 = 新版在前。 */
export function synthesizeVersionsMarkdown(times: Record<string, string>): string {
  return Object.entries(times)
    .filter(([v]) => !isPrereleaseVersion(v))
    .sort(([, a], [, b]) => b.localeCompare(a))
    .map(([v]) => `## ${v}\n`)
    .join('')
}

/** GitHub release tag → CHANGELOG 版本号:codex tag 带 rust- 前缀(rust-v0.151.0),
 *  matt-skills 为 v1.2.3——一个正则兼容两源。 */
const versionOfTag = (tag: string) => tag.replace(/^(?:rust-)?v/, '')

/** release 正文固定带的噪音小节(ADR-0050):Changelog = 版本对比链接 + **全量 PR/commit
 *  清单(实测 2026-08-31 40-100 行/版,commit 级历史)**——时间线里纯噪音,合成时整节剔除
 *  (信息直达取向;代价:PR 级明细只能去 releases 页看)。Contributors 实测无独立小节,
 *  保留防御上游模板加回。 */
const NOISE_SECTIONS = /^(?:Changelog|Contributors)$/

/** 剥前缀后须像版本号才进版本流:数字段 + 可选预发布后缀。滤掉 codex releases 流里的
 *  杂项 tag(实测 2026-08-31:rusty-v8-v150.4.0 vendored crate bump 混在前 100 里)。 */
const VERSION_LIKE_RE = /^\d+(\.\d+)*(?:-\S+)?$/

/** 合成原文源(ADR-0050,如 codex)的版本块合成:GitHub Releases API 响应 → `## 版本`
 *  + 正文的 markdown。转换:① 杂项 tag 滤除(VERSION_LIKE_RE);② 按 published_at 倒排——
 *  **不保 API 序**:API 按 created_at 排,实测 18/100 的 published_at 倒置,时间线与
 *  latest 判定都要真发布序;③ 行首 `## ` 降 `### `(release 小节是 ## 级,而 ## 是版本块
 *  边界,不降级会被 splitBlocks 切成独立版本块;``` 围栏内不降不判标题);④ 噪音小节
 *  整节剔除(到下一标题止);⑤ 无条目行(无小节标题且无 bullet)仅输出标题行——含占位
 *  正文与纯 prose:parseChangelog 只渲染条目行,空块判定与前端渲染语义对齐,上游占位
 *  措辞变化自愈。**含预发布**(Modal 全览位消费;块内滚动榜在前端过滤)。 */
export function composeReleasesMarkdown(
  releases: ReadonlyArray<{ tag_name?: string; published_at?: string; body?: string | null }>,
): string {
  return releases
    .filter(
      (r): r is { tag_name: string; published_at?: string; body?: string | null } =>
        typeof r.tag_name === 'string',
    )
    .map((r) => ({ version: versionOfTag(r.tag_name), at: r.published_at ?? '', body: r.body ?? '' }))
    .filter((r) => VERSION_LIKE_RE.test(r.version))
    .sort((a, b) => b.at.localeCompare(a.at))
    .map((r) => {
      const lines: string[] = []
      let inNoise = false
      let inFence = false
      for (const line of r.body.split('\n')) {
        if (!inFence && line.trim().startsWith('```')) {
          inFence = true
          lines.push(line)
          continue
        }
        if (inFence) {
          if (line.trim().startsWith('```')) inFence = false
          lines.push(line) // 围栏内原样(含形似标题的行,防内容损坏被译文哈希终身缓存)
          continue
        }
        const heading = line.match(/^#{1,6}\s+(.*)$/)
        if (heading) {
          inNoise = NOISE_SECTIONS.test(heading[1]!.trim())
          if (inNoise) continue
          // ## → ###(其余级别原样):release 小节降为版本块内小节
          lines.push(line.replace(/^##(?!#)/, '###'))
        } else if (!inNoise) {
          lines.push(line)
        }
      }
      const content = lines.join('\n').trimEnd()
      const hasEntries = /^#{2,3}\s/m.test(content) || /^[-*]\s/m.test(content)
      return hasEntries ? `## ${r.version}\n${content}\n` : `## ${r.version}\n`
    })
    .join('')
}

// ---- IDEA 原文合成(Data Services whatsnew;与 composeReleasesMarkdown 并列的第四原文形态)----

/** Data Services release 条目关心面:version/date/whatsnew;downloads/patches 等大字段忽略。 */
type JetbrainsRelease = { version?: unknown; date?: unknown; whatsnew?: unknown }

/** 版本号升序比较器(数值段逐段比,缺段作 0):IDEA 展示轴。字典序在 2026.10 vs 2026.2
 *  会错,必须数值比。 */
const compareVersion = (a: string, b: string): number => {
  const pa = a.split('.')
  const pb = b.split('.')
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (Number(pa[i]) || 0) - (Number(pb[i]) || 0)
    if (d) return d
  }
  return 0
}

/** whatsnew 行内 HTML → markdown:实体解码随 text() 自带;a→[text](href),链接文本剥
 *  方括号(上游 YouTrack 引用是 `[IJPL-xxx]` 形态,方括号嵌进 markdown 链接文本会扰乱
 *  渲染与译文)、非 http(s) href 弃链保文(与前端 inline() 的 https 门同语义)、
 *  em/i→*…*、strong/b→**…**、code→`…`、br→空格、其余标签递归剥。
 *  节点经 unknown 传递:cheerio 不 re-export domhandler 节点类型,这里只走 Cheerio
 *  方法面(is/attr/text),不裸触 DOM 字段。 */
const inlineWhatsnew = ($: cheerio.CheerioAPI, node: unknown): string => {
  const $el = $(node as never)
  const children = $el.contents().toArray()
  // 文本节点 / br:无子内容,前者取 text(实体解码自带),后者归一为空格
  if (children.length === 0) return $el.is('br') ? ' ' : $el.text()
  const inner = children.map((c) => inlineWhatsnew($, c)).join('')
  if ($el.is('a')) {
    const href = $el.attr('href') ?? ''
    const text = inner.replace(/[[\]]/g, '')
    return /^https?:/.test(href) ? `[${text}](${href})` : text
  }
  if ($el.is('em, i')) return `*${inner}*`
  if ($el.is('strong, b')) return `**${inner}**`
  if ($el.is('code')) return `\`${$el.text()}\``
  return inner
}

/** 版本块原文合成(IDEA):Data Services releases 条目 → `## 版本` + whatsnew 摘要 bullet。
 *  ① 杂项滤除(version 缺失/非版本样态);② **版本号降排**(2026-09-03 用户定案,替代
 *  此前的 date 倒排):LTS 分支(2025.3.x)补丁晚于主线 2026.2 发布,时间序会让两线交错
 *  (2025.3.6.1 插在 2026.2.1 与 2026.2 之间),版本号序按版本线聚集、LTS 归尾——latest
 *  判定同轴(jetbrainsInfo);③ 首个 p 是「…is out with the following improvements:」
 *  模板句,与版本行冗余,剔(同 ADR-0050 噪音剔除取向);其余 p(尾段 blog post 链接、
 *  hotfix 散文段)也作 bullet——parseChangelog 只渲染条目行,散文段落须落 `- ` 才可见;
 *  ④ 无 whatsnew(2018 前老版本,实测 2024+ 全有)仅输出标题行,与 codex 预发布空壳同
 *  语义。含全部正式版(块内滚动榜在前端过滤)。 */
export function composeWhatsnewMarkdown(releases: ReadonlyArray<JetbrainsRelease>): string {
  const bullet = (s: string): string | null => {
    const t = s.replace(/\s+/g, ' ').trim()
    return t ? `- ${t}` : null
  }
  return releases
    .map((r) => ({
      version: r.version,
      at: typeof r.date === 'string' ? r.date : '',
      html: typeof r.whatsnew === 'string' ? r.whatsnew : '',
    }))
    .filter(
      (r): r is { version: string; at: string; html: string } =>
        typeof r.version === 'string' && VERSION_LIKE_RE.test(r.version),
    )
    .sort((a, b) => compareVersion(b.version, a.version))
    .map((r) => {
      // fragment 模式(第三参 false):默认 document 模式会把顶层 p/ul 包进 <html>,
      // $.root().children() 拿到的就是 html 元素而非顶层段落
      const $ = cheerio.load(r.html, null, false)
      const lines: (string | null)[] = []
      let firstP = true
      for (const node of $.root().children().toArray()) {
        const $el = $(node)
        if ($el.is('ul')) {
          for (const li of $el.children('li').toArray()) lines.push(bullet(inlineWhatsnew($, li)))
        } else if ($el.is('p')) {
          if (firstP) {
            firstP = false
            continue
          }
          lines.push(bullet(inlineWhatsnew($, node)))
        }
      }
      const content = lines.filter((l) => l != null).join('\n')
      return content ? `## ${r.version}\n${content}\n` : `## ${r.version}\n`
    })
    .join('')
}

// ---- 编排(Java ChangelogService)----

/** 外源发布信息:latest(稳定轴)+ times(版本号→ISO,大 tile 版本榜单一行一版本带时间)。 */
export interface ReleaseInfo {
  latest: string | null
  times: Record<string, string>
}

/** IO 协作器,测试注入假实现(Java 的函数式接口对应物)。 */
export interface ChangelogDeps {
  /** 一次拉全「外源」(ADR-0053 取数单 adapter):原文 markdown **必在**——拉不到即抛错
   *  (兜底路径 500 / refreshQuietly 重试);发布信息**可空** = 显式部分成功(npm 日期源
   *  失败降级 null,调用方沿用旧值——GitHub 主链失败由实现方上抛,不吞:假成功会钉死
   *  空表到下个 6h 窗,ADR-0050)。「同周期单次抓取两用」(~26MB releases 不拉两次,
   *  ADR-0050 §5②)从调用序协议收为本函数 implementation 内的局部量。 */
  fetchUpstream: () => Promise<{ markdown: string; releaseInfo: ReleaseInfo | null }>
  /** 译制单个版本块(makeBlockTranslator 组装)。返回 null = 拒绝(如未配置 Key);
   *  抛错 = 译制失败。
   *  onPhase:每次尝试一个候选模型前上报(model, 候选序 1 基, 链长),Service 据此暴露译制阶段。 */
  translate: (
    versionBlock: string,
    onPhase?: (model: string, attempt: number, total: number) => void,
  ) => Promise<string | null>
}

/** 译制阶段(GET /api/changelog/translate/status 透传,内存态不落库):链上正在调
 *  LLM 时 translating(含候选细节),其余 idle——前端「排队中」推断 = 请求 pending
 *  且本状态 idle(排在 refresh 等链上前序任务后面,ADR-0017 互斥链)。 */
export interface TranslatePhase {
  status: 'idle' | 'translating'
  model?: string
  attempt?: number
  total?: number
  /** 进入 translating 的时刻(ISO),前端据此显示已耗时 */
  since?: string
}

export interface Snapshot {
  markdown: string
  releasedAt: string | null
  /** 每版本发布时间(版本号→ISO);发布信息失败/版本号错位为空条目,前端行级降级不显示。 */
  releaseTimes: Record<string, string>
  translatedVersions: string[]
  /** 供按需补译免重切 */
  blocks: Blocks
}

const nowIso = () => new Date().toISOString()

/** 快照表 release_times 列(JSON)解析;损坏/非对象兜底空表,不拦启动与刷新。 */
const parseTimes = (json: string | null | undefined): Record<string, string> => {
  try {
    const v: unknown = JSON.parse(json ?? '{}')
    return typeof v === 'object' && v !== null ? (v as Record<string, string>) : {}
  } catch {
    return {}
  }
}

export class ChangelogService {
  private memory: Snapshot | null = null
  /** Java synchronized 的 async 对应物:refresh/translateVersions 排到同一条链上串行执行 */
  private tail: Promise<unknown> = Promise.resolve()
  /** 译制阶段(内存读器供 status 路由;终态不驻留——请求回执才是终态信号) */
  private phase: TranslatePhase = { status: 'idle' }

  /** 返回副本:调用方(HTTP/测试)不持内部可变引用。 */
  translatePhase(): TranslatePhase {
    return { ...this.phase }
  }

  /** 哈希译文仓(ADR-0034):原文键 load/save,哈希派生收进 store。 */
  private readonly translations: TranslationStore

  constructor(
    private readonly db: Db,
    /** 本实例绑定的外源(scheduler 日志用;取数 URL 在 deps 里已按源定型)。 */
    readonly source: ChangelogSourceId,
    private readonly deps: ChangelogDeps,
    private readonly translateRecent = 5,
  ) {
    this.translations = makeTranslationStore(db, 'changelog_translations')
  }

  /** 读快照。内存空(首次部署、定时任务尚未跑成)→ 同步兜底刷新一次;仍失败则上抛 → 500。 */
  async get(): Promise<Snapshot> {
    if (!this.memory) await this.refresh()
    return this.memory!
  }

  /** 启动时从快照表恢复本源内存镜像:零外呼、零 LLM。本源无行则无操作,等定时/兜底路径。 */
  async loadFromDb(): Promise<void> {
    const row = await this.db
      .selectFrom('changelog_snapshots')
      .selectAll()
      .where('source', '=', this.source)
      .executeTakeFirst()
    if (!row) return
    const blocks = splitBlocks(row.raw_markdown)
    // releaseTimes 落库(2026-08-31 二次线上消失推翻 81888ea「不动」):恢复即带日期,
    // 启动预热/重试失败窗口里日期停旧值而非消失(实测两轮重试失败仍 11 分钟空窗)。
    this.memory = this.assemble(
      blocks,
      await this.translations.load(blocks.blocks.map((b) => b.raw)),
      row.released_at,
      parseTimes(row.release_times),
    )
  }

  /** 定时/预热刷新:拉原文 → 只译最近 N 版中缺失的块 → 快照落库 → 换内存镜像。拉取失败上抛,由调度方决定降级。 */
  async refresh(): Promise<void> {
    return this.exclusive(() => this.doRefresh())
  }

  /** 前端按需补译(ADR-0017):指定版本缺失则译、入库、重拼。已译的跳过(零 LLM),失败的该版保持英文。 */
  async translateVersions(titles: string[]): Promise<Snapshot> {
    return this.exclusive(async () => {
      if (!this.memory) await this.doRefresh() // 冷启动兜底(锁内,不可走加锁版防自锁)
      const { blocks, releasedAt, releaseTimes } = this.memory!
      const byRaw = await this.translations.load(blocks.blocks.map((b) => b.raw))
      for (const b of blocks.blocks) {
        if (titles.includes(b.title)) await this.translateIfMissing(b, byRaw)
      }
      this.memory = this.assemble(blocks, byRaw, releasedAt, releaseTimes)
      return this.memory
    })
  }

  private async doRefresh(): Promise<void> {
    // 单次取数一次返回(ADR-0053):releaseInfo 与 markdown 同刻到手——GitHub 主链失败在
    // 译制前即上抛(已声明漂移:省掉注定丢弃的 LLM 调用;译文逐块即存,重试 byRaw 命中零浪费)。
    const { markdown: raw, releaseInfo: info } = await this.deps.fetchUpstream()
    const blocks = splitBlocks(raw)
    const byRaw = await this.translations.load(blocks.blocks.map((b) => b.raw))
    // 只译最近 N 版中缺失的块;跳过空块(预发布占位)再取窗——否则 alpha 扎堆时窗口被占位块耗尽
    for (const b of blocks.blocks.filter(hasEntries).slice(0, this.translateRecent)) {
      await this.translateIfMissing(b, byRaw)
    }
    // 发布时间 immutable:merge 落库只增不减——新拉值覆盖同键旧值,新拉缺的版本(GitHub
    // 只回前 100 release)/发布信息失败(npm 分支吞错 null)保留旧值。否则空表会被当成功
    // 落库,日期钉死到下个 6h cron 窗(2026-08-31 二次线上消失的另一半洞)。
    const prev = await this.db
      .selectFrom('changelog_snapshots')
      .select(['release_times', 'released_at'])
      .where('source', '=', this.source)
      .executeTakeFirst()
    const releaseTimes = { ...parseTimes(prev?.release_times), ...(info?.times ?? {}) }
    // 空串守卫(npm time 条目可能为空串):releasedAt 语义 = ISO 或显式 null,不透 '';
    // 发布信息失败时保留旧值而非 null(同「一旦取到不丢」取向)
    const latestTime = info?.latest ? (info.times[info.latest] ?? '') : ''
    const releasedAt = latestTime.trim() ? latestTime : (prev?.released_at ?? null)
    const fetchedAt = nowIso()
    await this.db
      .insertInto('changelog_snapshots')
      .values({
        source: this.source,
        raw_markdown: raw,
        released_at: releasedAt,
        release_times: JSON.stringify(releaseTimes),
        fetched_at: fetchedAt,
      })
      .onConflict((oc) =>
        oc.column('source').doUpdateSet({
          raw_markdown: raw,
          released_at: releasedAt,
          release_times: JSON.stringify(releaseTimes),
          fetched_at: fetchedAt,
        }),
      )
      .execute()
    this.memory = this.assemble(blocks, byRaw, releasedAt, releaseTimes)
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn, fn).finally(() => {
      this.phase = { status: 'idle' } // 链空回 idle;后序任务 onPhase 会重新置 translating
    }) // 前者失败不阻塞后来者
    this.tail = run.catch(() => {})
    return run
  }

  /** 译一个块:已有译文(原文键)直接返回(零 LLM);译成则入库;失败/拒绝仅 warn,
   *  不入库待下轮重试。入库经译文仓(空串守卫/onConflict 收在 store,ADR-0034)。 */
  private async translateIfMissing(block: Block, byRaw: Map<string, string>): Promise<void> {
    if (byRaw.has(block.raw)) return
    if (!hasEntries(block)) return // 空块(直接 API 补译防呆):无可译,translateVersions 路径同守
    let translated: string | null
    try {
      translated = await this.deps.translate(block.raw, (model, attempt, total) => {
        // since 只在 idle→translating 设:换候选不重置——elapsed 语义 = 本次译制总等待,
        // 「译中 5s→归零重计」会被读成「重来了」;候选变化本身由 model/attempt 字段表达。
        this.phase =
          this.phase.status === 'translating'
            ? { ...this.phase, model, attempt, total }
            : { status: 'translating', model, attempt, total, since: nowIso() }
      })
    } catch (e) {
      console.warn(`版本 ${block.title} 译制失败,保持英文:`, e)
      return
    }
    if (translated == null) {
      console.warn(`版本 ${block.title} 译制被拒绝(API Key 缺失?),保持英文`)
      return
    }
    await this.translations.save([{ text: block.raw, translated }])
    byRaw.set(block.raw, translated)
  }

  /** 拼装:前缀 + 每块取译文(原文键命中)或原文。translatedVersions 与拼装同源。 */
  private assemble(
    blocks: Blocks,
    byRaw: Map<string, string>,
    releasedAt: string | null,
    releaseTimes: Record<string, string>,
  ): Snapshot {
    let markdown = blocks.prefix
    const translatedVersions: string[] = []
    for (const b of blocks.blocks) {
      const translated = byRaw.get(b.raw)
      if (translated !== undefined) {
        markdown += translated.endsWith('\n') ? translated : `${translated}\n`
        translatedVersions.push(b.title)
      } else {
        markdown += b.raw
      }
    }
    return { markdown, releasedAt, releaseTimes, translatedVersions, blocks }
  }
}

// ---- HTTP 路由(Java ChangelogController,契约 api-contract.md §6;?source 分流见 ADR-0020)----

/** 源 id → Service 映射;index.ts 按 CHANGELOG_SOURCES 逐源构造。 */
export type ChangelogServices = Record<ChangelogSourceId, ChangelogService>

export function changelogRoutes(services: ChangelogServices): Hono<AuthEnv> {
  /** ?source= 选源;缺省/未知回落默认源(前端 changelogSourceOf 已兜底,此处双保险)。 */
  const pick = (c: Context<AuthEnv>) =>
    services[(c.req.query('source') as ChangelogSourceId) ?? DEFAULT_CHANGELOG_SOURCE] ??
    services[DEFAULT_CHANGELOG_SOURCE]
  const toResponse = (s: Snapshot) => ({
    markdown: s.markdown,
    releasedAt: s.releasedAt, // 失败时显式 null(输出不省略),前端日期行降级「—」
    releaseTimes: s.releaseTimes, // 空表 = 发布信息失败/重启恢复窗口,前端版本行时间降级不显示
    translatedVersions: s.translatedVersions,
  })
  return new Hono<AuthEnv>()
    .get('/api/changelog', async (c) => c.json(toResponse(await pick(c).get())))
    .get('/api/changelog/translate/status', (c) => c.json(pick(c).translatePhase()))
    .post('/api/changelog/translate', async (c) => {
      const body = await jsonBody(c)
      const versions = (body as { versions?: unknown } | null)?.versions
      const list = Array.isArray(versions) ? versions.filter((v): v is string => typeof v === 'string') : []
      return c.json(toResponse(await pick(c).translateVersions(list)))
    })
}

// ---- 生产协作器(Java ChangelogConfig/NpmReleaseDateService 对应物;源定义在 shared)----
// 网关地基(sha256/LLM_BASE_URL/候选链/响应解析)与调模型原语在 translate.ts(ADR-0032)。

/** 译制系统提示(照搬 Java,ADR-0005):确定性靠提示约束,GPT-5 系 temperature 被网关忽略。 */
const SYSTEM_PROMPT = `你是专业技术译者。把用户给出的 CHANGELOG markdown 片段由英文译成简体中文。
严格约束：
1. 只输出译制后的 markdown 片段本身，不要任何解释、前后缀、也不要代码围栏 \`\`\`。
2. 原样保留全部结构：## / ### 标题层级、- 列表符号、空行。
3. 原样保留全部行内 markdown：\`code\`、**bold**、[text](url)。
4. 不要翻译：版本号（如 1.2.3）、代码片段内容、URL、命令名、配置键名。
5. 通用技术术语（Claude Code、API、token、hook 等）可保留原文或按惯例中译。`

// fetchText 已收归 common.ts(changelog/videoUpdates/modelTracking 三处同形)

export function prodChangelogDeps(source: ChangelogSourceId = DEFAULT_CHANGELOG_SOURCE): ChangelogDeps {
  const def = getChangelogSource(source)
  // GitHub API 认证(可选):未认证限额 60 req/h 按出口 IP 计,机场共享出口常态被耗光
  // (2026-08-31 matt 发布日期 403 remaining:0);带 token 提至 5000/h。缺省无头,行为不变。
  const githubToken = process.env.GITHUB_TOKEN ?? ''
  // 解构到 const:narrowing 才能保进 fetchText 回调(属性访问的收窄不进闭包)
  const rawUrl = def.changelogUrl
  const releasesApiUrl = def.githubReleasesApiUrl
  const jetbrainsApiUrl = def.jetbrainsReleasesApiUrl
  /** GitHub Releases 真拉(不吞错、不缓存)。失败不回落 npm——matt 配 GitHub 正因 npm
   *  版本键错位。 */
  const fetchGithubReleases = async (): Promise<
    Array<{ tag_name?: string; published_at?: string; body?: string | null }>
  > =>
    // ponytail:只取前 100 个 release;Matt 当前不足 10 个,超过后按 GitHub Link 头分页。
    JSON.parse(
      await fetchText(releasesApiUrl!, 30_000, {
        headers: githubToken ? { Authorization: `Bearer ${githubToken}` } : undefined,
      }),
    )
  /** times(版本→ISO/日期)→ 最新稳定版(比较器参数化,轴随源):全量最新可能是预发布
   *  (codex alpha 日均 2-3 个),稳定轴与 npm dist-tags.latest 同。GitHub/tag 源时间序
   *  (等长 ISO 串字典序即时间序),IDEA 版本号序(与列表同轴,LTS 补丁 date 更晚也不夺 latest)。 */
  const latestStable = (times: Record<string, string>, desc: (a: string, b: string) => number): string | null =>
    Object.keys(times)
      .filter((v) => !isPrereleaseVersion(v))
      .sort(desc)[0] ?? null
  /** Releases → 发布信息:tag 去前缀、版本样态过滤;latest = 最新稳定版:releasedAt 供
   *  块内鲜度回退,取全量最新会把预发布时间戳算到稳定版头上(codex alpha 日均 2-3 个)。 */
  const releasesInfo = (releases: Awaited<ReturnType<typeof fetchGithubReleases>>): ReleaseInfo => {
    const times: Record<string, string> = {}
    for (const release of releases) {
      if (release.tag_name && release.published_at) {
        const v = versionOfTag(release.tag_name)
        if (VERSION_LIKE_RE.test(v)) times[v] = release.published_at
      }
    }
    return { latest: latestStable(times, (a, b) => times[b]!.localeCompare(times[a]!)), times }
  }
  /** npm 日期源(降级语义住此):失败吞错返回 null——调用方 merge 沿用旧值,不阻塞主链路。
   *  npmPackage 缺失(IDEA 非 npm 发行)是注册表配置错误,上抛不吞:该函数唯一消费方是
   *  无原文源分支(前提 npm 源),走不到即不该被调用。 */
  const fetchNpmReleaseInfo = async (): Promise<ReleaseInfo | null> => {
    const npmPackage = def.npmPackage
    if (!npmPackage) throw new Error(`源 ${def.id} 缺 npmPackage 配置,无法走 npm 日期源`)
    try {
      const root = JSON.parse(
        await fetchText(`https://registry.npmjs.org/${npmPackage}`, 30_000),
      ) as {
        'dist-tags'?: { latest?: string }
        time?: Record<string, string>
      }
      return { latest: root['dist-tags']?.latest ?? null, times: root.time ?? {} }
    } catch (e) {
      console.warn('拉取发布信息失败,版本时间降级:', e)
      return null
    }
  }
  /** Data Services releases 真拉(不吞错,同 GitHub 主链)。响应形如 {"IIU":[…]},单 code
   *  键取首值(注册表 URL 均单 code,多产品不混)。响应含 downloads/patches 全量 ~MB 级,超时放 60s。 */
  const fetchJetbrainsReleases = async (): Promise<JetbrainsRelease[]> => {
    const byCode = JSON.parse(await fetchText(jetbrainsApiUrl!, 60_000)) as Record<
      string,
      JetbrainsRelease[]
    >
    return Object.values(byCode)[0] ?? []
  }
  /** releases → 发布信息:version/date 直用(无 tag 前缀问题);latest 稳定轴取版本号
   *  最大(与列表同轴,compareVersion)——上游数组按产品分支序排,数组序/date 序都不
   *  作为轴(LTS 补丁 date 可以晚于主线,2025.3.6.2 实测 date 2026-09-03)。 */
  const jetbrainsInfo = (releases: JetbrainsRelease[]): ReleaseInfo => {
    const times: Record<string, string> = {}
    for (const r of releases) {
      if (typeof r.version === 'string' && typeof r.date === 'string' && VERSION_LIKE_RE.test(r.version)) {
        times[r.version] = r.date
      }
    }
    return { latest: latestStable(times, (a, b) => compareVersion(b, a)), times }
  }
  // 取数单 adapter(ADR-0053):原文四形态(ADR-0050——changelogUrl 直取 raw CHANGELOG.md;
  // githubReleasesApiUrl 合成 release 正文;jetbrainsReleasesApiUrl 合成 whatsnew 摘要;
  // 三者皆无 = 无原文源,npm time 合成空块)一次返回「原文 + 发布信息」。markdown 必在:
  // 拉不动作主链路失败上抛——refresh 沿用旧快照 / 冷启动 500。GitHub/Data Services 主链
  // (合成源/matt 日期)失败**上抛**不吞:假成功会钉死空表到下个 6h 窗(2026-08-31 matt
  // 实录,81888ea 同动机的收编);npm 日期源失败降级 null。合成源的「单次抓取两用」
  // (~26MB 响应不拉两次,ADR-0050 §5②)原是两函数间的调用序协议(composedReleases
  // 共享态),现为本函数内局部量。
  const fetchUpstream: ChangelogDeps['fetchUpstream'] = async () => {
    if (rawUrl) {
      const markdown = await fetchText(rawUrl, 60_000)
      // GitHub 主链不吞错(见上);matt 形态日期走 GitHub,raw 形态(如 claude-code)走 npm
      const releaseInfo = releasesApiUrl
        ? releasesInfo(await fetchGithubReleases())
        : await fetchNpmReleaseInfo()
      return { markdown, releaseInfo }
    }
    if (releasesApiUrl) {
      const releases = await fetchGithubReleases()
      return { markdown: composeReleasesMarkdown(releases), releaseInfo: releasesInfo(releases) }
    }
    if (jetbrainsApiUrl) {
      const releases = await fetchJetbrainsReleases()
      return { markdown: composeWhatsnewMarkdown(releases), releaseInfo: jetbrainsInfo(releases) }
    }
    const info = await fetchNpmReleaseInfo()
    if (!info) throw new Error(`npm packument(${def.npmPackage}) 拉取失败,无法合成版本流`)
    return { markdown: synthesizeVersionsMarkdown(info.times), releaseInfo: info }
  }
  return {
    fetchUpstream,
    // 译制机制(候选链/分段/onPhase)单点 translate.ts(ADR-0032 地基 + ADR-0053 归位);
    // SYSTEM_PROMPT 是「更新日志」域的译制词表,留域内(同 trending 传 TRENDING_SYSTEM_PROMPT 先例)。
    translate: makeBlockTranslator(SYSTEM_PROMPT, `changelog-translate-${source}`),
  }
}

// ---- 定时预取(Java ChangelogScheduler)----

/** 刷新失败沿用旧快照并 5 分钟后重试,成功即停。动机(2026-08-31 线上):启动预热恰逢
 *  网络抖动超时后无重试,空 releaseTimes 被钉死到下个 6h cron 窗——版本行日期整列消失
 *  ~5h(releaseTimes 同日落库后,重试失利的代价降为日期停旧值)。重试与 cron 并发由
 *  Service exclusive 串行链兜底(最坏多一次幂等刷新)。 */
export function refreshQuietly(service: ChangelogService, retryMs = 5 * 60_000): void {
  service.refresh().catch((e) => {
    console.warn(`更新日志(${service.source})定时刷新失败,沿用现有快照:`, e)
    setTimeout(() => refreshQuietly(service, retryMs), retryMs)
  })
}

/** 启动两步:先恢复快照(零外呼)再异步预热;此后每 6h 刷新。失败沿用旧快照并重试(见上)。
 *  逐源各一套(ADR-0020):每源独立恢复/预热/定时,一源失败不涉其它。 */
export function startChangelogScheduler(services: readonly ChangelogService[]): void {
  for (const service of services) {
    void service.loadFromDb().then(() => refreshQuietly(service))
    schedule('0 */6 * * *', () => void refreshQuietly(service))
  }
}
