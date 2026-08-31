import { schedule } from 'node-cron'
import { Hono, type Context } from 'hono'
import {
  DEFAULT_CHANGELOG_SOURCE,
  getChangelogSource,
  type ChangelogSourceId,
} from 'chrome-tab-shared'
import type { Db } from './db'
import type { AuthEnv } from './auth'
import { fetchText, jsonBody } from './common'
import {
  callModel,
  isCandidateExhausted,
  makeTranslationStore,
  modelCandidates,
  type TranslationStore,
} from './translate'

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

/** 版本块再切段(2026-08-26):段 = 连续整行(行是原子,不撕开),总长 ≤ maxChars;
 *  单行自身超限独占一段。动机:非流式译制耗时 ∝ 输出长度,2.1.246 块 9.2k 字符单请求
 *  生成 >60s,7 候选全超时;切段后单请求输出 ~1/N(~700 字符),稳离 60s 上限,
 *  段失败换候选只重试该段。段边界在行尾,译文段拼回即整块译文。 */
export function splitSegments(block: string, maxChars = 2000): string[] {
  if (block.length <= maxChars) return [block]
  const segments: string[] = []
  let cur = ''
  for (const line of block.split(/(?<=\n)/)) {
    if (cur && cur.length + line.length > maxChars) {
      segments.push(cur)
      cur = ''
    }
    cur += line
  }
  if (cur) segments.push(cur)
  return segments
}

/** 无原文源(如 Codex,changelogUrl 缺省)的版本流合成:npm time 表 → 每版本一行 `## `
 *  标题空块的 markdown,下游 splitBlocks / 前端 parseChangelog 照常切出版本列表(块内无
 *  条目、也无从译制)。剔 created/modified 元键与 prerelease(alpha 比稳定版多且新,进榜
 *  只添噪);npm time 值为等长 ISO 串,字典序即时间序,倒排 = 新版在前。 */
export function synthesizeVersionsMarkdown(times: Record<string, string>): string {
  return Object.entries(times)
    .filter(([v]) => /^\d+(\.\d+)*$/.test(v))
    .sort(([, a], [, b]) => b.localeCompare(a))
    .map(([v]) => `## ${v}\n`)
    .join('')
}

// ---- 编排(Java ChangelogService)----

/** IO 协作器,测试注入假实现(Java 的函数式接口对应物)。 */
export interface ChangelogDeps {
  /** 拉 CHANGELOG.md 原文。抛错 → 兜底路径 500,前端走「刷新失败/重试」。 */
  fetchMarkdown: () => Promise<string>
  /** 译制单个版本块。返回 null = 拒绝(如未配置 Key);抛错 = 译制失败。
   *  onPhase:每次尝试一个候选模型前上报(model, 候选序 1 基, 链长),Service 据此暴露译制阶段。 */
  translate: (
    versionBlock: string,
    onPhase?: (model: string, attempt: number, total: number) => void,
  ) => Promise<string | null>
  /** 外源全量发布信息:latest + times(版本号→ISO,大 tile 版本榜单一行一版本
   *  带时间)。失败由实现方吞掉返回 null,不阻塞主链路。 */
  fetchReleaseInfo: () => Promise<{ latest: string | null; times: Record<string, string> } | null>
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
    // releaseTimes 不落库:恢复镜像时置空表,启动紧跟的 refreshQuietly(见调度器)拉发布信息补齐,
    // 缺失窗口仅重启后数秒——省一列迁移与快照表读写。
    this.memory = this.assemble(blocks, await this.translations.load(blocks.blocks.map((b) => b.raw)), row.released_at, {})
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
    const raw = await this.deps.fetchMarkdown()
    const blocks = splitBlocks(raw)
    const byRaw = await this.translations.load(blocks.blocks.map((b) => b.raw))
    for (const b of blocks.blocks.slice(0, this.translateRecent)) {
      await this.translateIfMissing(b, byRaw)
    }
    const info = await this.deps.fetchReleaseInfo()
    // 空串守卫(npm time 条目可能为空串):releasedAt 语义 = ISO 或显式 null,不透 ''
    const latestTime = info?.latest ? (info.times[info.latest] ?? '') : ''
    const releasedAt = latestTime.trim() ? latestTime : null
    const releaseTimes = info?.times ?? {}
    const fetchedAt = nowIso()
    await this.db
      .insertInto('changelog_snapshots')
      .values({ source: this.source, raw_markdown: raw, released_at: releasedAt, fetched_at: fetchedAt })
      .onConflict((oc) =>
        oc
          .column('source')
          .doUpdateSet({ raw_markdown: raw, released_at: releasedAt, fetched_at: fetchedAt }),
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
  const apiKey = process.env.AIHUBMIX_API_KEY ?? ''
  const models = modelCandidates()
  // 解构到 const:narrowing 才能保进 fetchText 回调(属性访问的收窄不进闭包)
  const rawUrl = def.changelogUrl
  const fetchReleaseInfo = async () => {
    try {
      if (def.githubReleasesApiUrl) {
        // ponytail:只取前 100 个 release;Matt 当前不足 10 个,超过后按 GitHub Link 头分页。
        const releases = JSON.parse(await fetchText(def.githubReleasesApiUrl, 30_000)) as Array<{
          tag_name?: string
          published_at?: string
        }>
        const times: Record<string, string> = {}
        for (const release of releases) {
          if (release.tag_name && release.published_at) {
            times[release.tag_name.replace(/^v/, '')] = release.published_at
          }
        }
        return { latest: Object.keys(times)[0] ?? null, times }
      }
      const root = JSON.parse(
        await fetchText(`https://registry.npmjs.org/${def.npmPackage}`, 30_000),
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
  return {
    // 无原文源(changelogUrl 缺省,如 codex):版本流从 npm time 表合成。npm 拉不动作
    // 主链路失败上抛——refresh 沿用旧快照 / 冷启动 500,与「拉 CHANGELOG.md 失败」同语义。
    fetchMarkdown: rawUrl
      ? () => fetchText(rawUrl, 60_000)
      : async () => {
          const info = await fetchReleaseInfo()
          if (!info) throw new Error(`npm packument(${def.npmPackage}) 拉取失败,无法合成版本流`)
          return synthesizeVersionsMarkdown(info.times)
        },
    fetchReleaseInfo,
    translate: async (block, onPhase) => {
      if (!apiKey) return null // Key 缺失:Service 层据此透传英文原文
      const segments = splitSegments(block)
      /** 单段走候选链:候选失效换下一个,全链失效上抛(整块失败,Service 层 warn 降级)。 */
      const translateSegment = async (seg: string, si: number): Promise<string> => {
        let lastErr: unknown
        for (const [i, model] of models.entries()) {
          onPhase?.(model, i + 1, models.length)
          const startedAt = Date.now()
          // 每次尝试一行结果日志(线上排障:段/模型/序号/耗时/status+body/走向,全部收容器 stdout)
          const log = (outcome: string, extra = '') =>
            console.warn(`[changelog-translate] ${source} 段${si + 1}/${segments.length} 候选 ${i + 1}/${models.length} ${model} ${outcome}(${Date.now() - startedAt}ms)${extra}`)
          try {
            const { content, resp } = await callModel(model, apiKey, SYSTEM_PROMPT, seg)
            // 200 但拿不到译文(空补全/内容过滤/非 JSON 响应体)也按候选失效换下一个——
            // 2026-08-25 线上即此形态静默失败:后台有 200 调用记录、无后续候选、译文缺位。
            // 空串同判:空译文会以哈希主键终身缓存,该版本永久渲染成空行(批量路径
            // parseNumberedTranslations 的 !text 守卫同款,code-review 补齐)
            if (content == null || !content.trim()) {
              lastErr = new Error(`HTTP 200 但响应无 content:${resp.slice(0, 200)}`)
              log(`失败: ${lastErr}`, ',换下一候选')
              continue
            }
            log(`成功: ${content.length} 字符`)
            return content
          } catch (e) {
            if (!isCandidateExhausted(e)) {
              log(`失败: ${e}`, ',换模型无益,放弃本次译制')
              throw e
            }
            lastErr = e
            log(`失败: ${e} ${(e as { body?: string }).body ?? ''}`, ',换下一候选')
          }
        }
        throw lastErr
      }
      // 串行逐段(free 渠道限流敏感,不并发);非末段译文补尾换行——LLM 偶尔丢,缺了会与下段粘行
      // (末段不补:单段块行为不变,块级兜底在 assemble)
      const out: string[] = []
      for (const [si, seg] of segments.entries()) out.push(await translateSegment(seg, si))
      return out
        .map((t, i) => (i < out.length - 1 && !t.endsWith('\n') ? `${t}\n` : t))
        .join('')
    },
  }
}

// ---- 定时预取(Java ChangelogScheduler)----

/** 刷新失败沿用旧快照并 5 分钟后重试,成功即停。动机(2026-08-31 线上):releaseTimes
 *  不落库、重启恢复即空表,启动预热恰逢网络抖动超时后无重试,空表被钉死到下个 6h
 *  cron 窗——版本行日期整列消失 ~5h。重试与 cron 并发由 Service exclusive 串行链兜底
 *  (最坏多一次幂等刷新)。 */
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
