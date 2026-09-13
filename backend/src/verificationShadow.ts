import Database from 'better-sqlite3'
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite'
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { ModelProviderId, ModelVerificationChainStatus } from 'chrome-tab-shared'
import { makeEvidence } from './evidence'
import type { Db } from './db'
import { makeClueLedger } from './clueLedger'
import { PROVIDERS, parseSourcePages } from './modelTracking'
import { callModel } from './llm'
import type { SourceRole } from './adjudication'
import { SOURCE_INTERVAL_MS, sourceIsStale } from './providers/def'
import type { PendingClue, ProviderDef } from './providers/def'
import {
  computeEvidenceFingerprint,
  makeVerificationGraph,
  type AcceptPlan,
  type ArchiveModelRef,
  type ReadRecord,
  type VerificationDeps,
  type VerificationExit,
  type VerificationGraph,
  type VerificationTask,
} from './verificationGraph'

/**
 * 影子核验调度(CONTEXT.md「无人值守数据核验」;ADR-0062 调度与执行,issues/05):把核验图
 * (verificationGraph.ts)挂上生产轨道但**零生产写**——新链跑真流量、核验结果只读落 jsonl,
 * 旧核验链(modelTracking.verifyPendingClues)照常生产,影子期自交付起自然积累。切换
 * (issues/11)后本模块的注册表语义由线索账本的指纹重开(clueLedger.reopenIfFingerprintChanged)
 * 接管,jsonl 落点换真 SQLite 事务。
 *
 * 线程生命周期(spec 实现决策):thread_id = 线索 + 证据指纹;SqliteSaver(sync)单机嵌入,
 * **checkpoint 仅执行进度**——本模块的私有 sqlite 文件(data/verification.db)同时持有
 * saver 表与影子注册表(shadow_runs),与生产库(newtab.db)物理隔离,影子零生产写由此保证。
 * 终态线程 7 天清理(checkpoint 膨胀控制;注册表行保留——指纹知识是重开判定的底册),
 * 运行中/退避中永不清理(重扫要续跑)。
 *
 * 证据指纹(调度侧)= SHA-256(线索三元组 + **全部**白名单信源页内容):thread_id 须先于
 * invoke 可算且跨轮稳定,图内 reads 子集依赖 LLM 选择不满足;预抓页以缓存注入图内
 * fetchText(免双重抓取)。预抓全部失败不短路——图内按需重抓是真实的第二次机会。
 *
 * invoke 三分支(getState 实证,issues/05):中断线程带 input 重 invoke 会重置状态重启而非
 * 续跑——续跑必须 invoke(null);已完成线程带 input 重 invoke 从头重跑 = 退避重试语义;
 * next 空且 exit 非空 = 已完成未记账(invoke 返回与记账之间崩溃)→ 采纳不再 invoke。
 */

/** 影子调度注入面(测试零真网;fetch/env/call 同 ModelTrackingDeps 口径)。 */
export interface ShadowDeps {
  fetchText: (url: string, timeoutMs: number) => Promise<string>
  env?: NodeJS.ProcessEnv
  /** LLM 单次调用注入;缺省真 callModel(网关闸门在其内部)。 */
  call?: VerificationDeps['call']
}

export interface ShadowConfig {
  /** 私有 sqlite 文件路径(saver 表 + 影子注册表;与生产库隔离)。 */
  checkpointDbPath: string
  /** 核验结果 jsonl 落点(影子期唯一产物)。 */
  jsonlPath: string
}

/** 影子注册表行(shadow_runs;state 三值:running/backoff/terminal)。 */
interface ShadowRunRow {
  provider: string
  model_key: string
  occurred_on: string
  title: string
  source_url: string
  thread_id: string
  fingerprint: string
  state: 'running' | 'backoff' | 'terminal'
  exit_json: string | null
  thread_cleaned: number
  updated_at: string
}

/** 终态线程清理窗(用户故事 26:终态执行轨迹保留 7 天调试窗)。 */
const THREAD_CLEANUP_DAYS = 7
/**
 * 终态重开检查窗(实现侧判断):与账本 ingest 窗同轴同宽——线索滚出信源(30 天)后页面
 * 语境已逝,不再重开。调度指纹已收窄到线索专属页(见 runItem),共享注册页变化不再
 * 触发全 provider 重开,改走 shadow_rechecks 逐模型强制重核;剩余天花板 = 线索自有页
 * 本身变化(changelog 类 append-only 页对旧线索影响小),量级实测归票 10/11。
 */
const REOPEN_WINDOW_DAYS = 30

/** 重核线索的 modelKey 前缀(官方资料变化重核的注册表键;真线索键不与此形态碰撞)。 */
const RECHECK_KEY_PREFIX = 'recheck:'

/**
 * 线索专属页集(调度指纹的唯一锚定面;重核线索无线索页)。**单点导出**:runItem 与
 * 预播种测试助手共用——同一条目经 recheck 队列与 nonTerminal 重扫两通道进来若基准
 * 分家,指纹必然不等,在途 checkpoint 被误删、崩溃续跑自愈失效。
 */
export function clueOwnedUrls(def: ProviderDef<unknown>, clue: PendingClue): Set<string> {
  if (clue.modelKey.startsWith(RECHECK_KEY_PREFIX)) return new Set()
  return new Set([clue.sourceUrl, ...(def.verifyUrls?.(clue) ?? [])])
}

/** error 出口(系统错误)重投退避窗 = 三个轮次:网关 5xx/超时类瞬时故障按此节奏重试;
 *  无窗的每 2h 重投会让持续 error 的项无限烧 LLM(卡死模型 × 每轮 1-2 次真实调用)。 */
const ERROR_RETRY_MS = 6 * 3600_000

/**
 * 指纹底册的存储形态版本:normalizeSourcePage/白名单语义升级时递增——新版本首轮只建
 * 底册不判变化,规范化器升级不冒充「官方资料变化」触发全量重核风暴(跨厂家同步 LLM
 * 尖峰)。旧版本 key 自然废弃不迁移。
 */
const FINGERPRINT_BASIS_VERSION = 2

const nowIso = () => new Date().toISOString()
const isoDaysAgo = (days: number) => new Date(Date.now() - days * 86400_000).toISOString()
const dayCutoff = (days: number) => isoDaysAgo(days).slice(0, 10)

const RUNS_DDL = `
CREATE TABLE IF NOT EXISTS shadow_runs (
  provider       TEXT NOT NULL,
  model_key      TEXT NOT NULL,
  occurred_on    TEXT NOT NULL,
  title          TEXT NOT NULL,
  source_url     TEXT NOT NULL,
  thread_id      TEXT NOT NULL,
  fingerprint    TEXT NOT NULL,
  state          TEXT NOT NULL CHECK (state IN ('running','backoff','terminal')),
  exit_json      TEXT,
  thread_cleaned INTEGER NOT NULL DEFAULT 0,
  updated_at     TEXT NOT NULL,
  PRIMARY KEY (provider, model_key)
);
CREATE TABLE IF NOT EXISTS shadow_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS shadow_rechecks (
  provider TEXT NOT NULL, model_key TEXT NOT NULL, occurred_on TEXT NOT NULL,
  title TEXT NOT NULL, source_url TEXT NOT NULL, PRIMARY KEY (provider, model_key)
);`

/** 六类注册信源 + 线索一手页;同 URL 可承担多个角色——verifyUrls 补充的条目**不去重**,
 *  同 URL 双角色并存(图内 citations 按 task.sources 全角色展开):anthropic overview.md
 *  注册为 catalog 却是规格主源,若被注册角色吞掉 release 角色,availability/released_at
 *  观察在矩阵里就无权(只认 release/weights),系统性暂缓。 */
function whitelistOf(def: ProviderDef<unknown>, clue: PendingClue): Array<{ role: SourceRole; url: string }> {
  const sources = (Object.keys(SOURCE_INTERVAL_MS) as SourceRole[])
    .flatMap((role) => def.sources[role].urls.map((url) => ({ role, url })))
  // 重核线索的 modelKey 是注册表键非模型 ID,内插 verifyUrls 是保证 404 的死链
  if (clue.modelKey.startsWith(RECHECK_KEY_PREFIX)) return sources
  for (const url of def.verifyUrls?.(clue) ?? [clue.sourceUrl]) sources.push({ role: 'release', url })
  return sources
}

/**
 * 影子核验调度器。返回 round()(一轮重扫,2h cron 在轮询后驱动;内部并发自守卫,
 * 重入即跳过)与 graph/sqlite(测试接缝:断点续跑预播种与注册表断言;生产不消费)。
 */
export function makeShadowVerification(db: Db, deps: ShadowDeps, config: ShadowConfig) {
  mkdirSync(dirname(config.checkpointDbPath), { recursive: true })
  mkdirSync(dirname(config.jsonlPath), { recursive: true })
  const sqlite = new Database(config.checkpointDbPath)
  sqlite.exec(RUNS_DDL)
  const saver = new SqliteSaver(sqlite)
  const ledger = makeClueLedger(db)
  const evidenceStore = makeEvidence(db)

  // ---- 注册表(私有文件内自有 schema;better-sqlite3 同步)----

  const q = {
    get: sqlite.prepare<[string, string], ShadowRunRow>('SELECT * FROM shadow_runs WHERE provider = ? AND model_key = ?'),
    register: sqlite.prepare(
      `INSERT INTO shadow_runs (provider, model_key, occurred_on, title, source_url, thread_id, fingerprint, state, updated_at)
       VALUES (@provider, @modelKey, @occurredOn, @title, @sourceUrl, @threadId, @fingerprint, 'running', @updatedAt)
       ON CONFLICT (provider, model_key) DO UPDATE SET
         occurred_on = @occurredOn, title = @title, source_url = @sourceUrl,
         thread_id = @threadId, fingerprint = @fingerprint, state = 'running',
         exit_json = NULL, thread_cleaned = 0, updated_at = @updatedAt`,
    ),
    finish: sqlite.prepare(
      `UPDATE shadow_runs SET state = @state, exit_json = @exitJson, updated_at = @updatedAt
       WHERE provider = @provider AND model_key = @modelKey`,
    ),
    // 只打 thread_cleaned 标不 bump updated_at:terminal 行的 updated_at 是裁决时刻
    // (chainStats 的「最近成功裁决」取它),清理打标冒充不得(Mark Cleaned ≠ 新裁决)。
    markCleaned: sqlite.prepare('UPDATE shadow_runs SET thread_cleaned = 1 WHERE provider = ? AND model_key = ?'),
    nonTerminal: sqlite.prepare<[], ShadowRunRow>(`SELECT * FROM shadow_runs WHERE state != 'terminal' ORDER BY updated_at ASC`),
    terminalInWindow: sqlite.prepare<[string], ShadowRunRow>(
      `SELECT * FROM shadow_runs WHERE state = 'terminal' AND occurred_on >= ? ORDER BY updated_at ASC`,
    ),
    cleanupCandidates: sqlite.prepare<[string], ShadowRunRow>(
      `SELECT * FROM shadow_runs WHERE state = 'terminal' AND thread_cleaned = 0 AND updated_at < ?`,
    ),
    metaGet: sqlite.prepare<[string], { value: string }>('SELECT value FROM shadow_meta WHERE key = ?'),
    metaSet: sqlite.prepare('INSERT INTO shadow_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value'),
  }

  const rowToClue = (row: ShadowRunRow): PendingClue & { provider: ModelProviderId } => ({
    provider: row.provider as ModelProviderId,
    occurredOn: row.occurred_on,
    title: row.title,
    sourceUrl: row.source_url,
    modelKey: row.model_key,
  })

  const appendLine = (rec: Record<string, unknown>): void => {
    appendFileSync(config.jsonlPath, `${JSON.stringify(rec)}\n`)
  }

  // ---- 图装配(生产读侧 + 注入 fetch/call;commit = jsonl 落点,零生产写)----

  /** 当前工作项的预抓缓存(commit 落 jsonl 的上下文同款:轮次内串行,单槽即可)。 */
  let prefetch = new Map<string, string>()
  let commitCtx: { provider: string; modelKey: string; threadId: string; fingerprint: string } | null = null

  const graphDeps: VerificationDeps = {
    fetchText: async (url, timeoutMs) => prefetch.get(url) ?? deps.fetchText(url, timeoutMs),
    listModels: async (provider) => {
      const rows = await db
        .selectFrom('model_archive')
        .select(['id', 'official_id', 'name', 'stage', 'match_aliases'])
        .where('provider', '=', provider)
        .orderBy('id', 'asc')
        .execute()
      return rows.map((r): ArchiveModelRef => ({
        modelId: r.id,
        officialId: r.official_id,
        name: r.name,
        stage: r.stage,
        matchAliases: JSON.parse(r.match_aliases) as string[],
      }))
    },
    listEvidence: (provider) => evidenceStore.listByProvider(provider),
    fieldCurrent: async (modelId, field) => {
      // 档案列直读(release 页之外的列形态 JSON);released_at/retired_at 无档案列 →
      // 最近同 kind 事件的 occurredOn 作当前值(事件即该字段的存档形态)
      if (field === 'released_at' || field === 'retired_at') {
        const ev = await db
          .selectFrom('model_events')
          .select(['occurred_on'])
          .where('model_id', '=', modelId)
          .where('kind', '=', field === 'released_at' ? 'released' : 'retired')
          .orderBy('occurred_on', 'desc')
          .limit(1)
          .executeTakeFirst()
        if (ev === undefined) return null
        return { value: ev.occurred_on, evidence: await evidenceStore.latest(modelId, field) }
      }
      const col = { pricing: 'pricing', limits: 'limits', training_params: 'training_params', stage: 'stage', availability: 'availability' } as const
      const column = col[field as keyof typeof col]
      if (column === undefined) return null
      const row = await db
        .selectFrom('model_archive')
        .select([column])
        .where('id', '=', modelId)
        .executeTakeFirst()
      const raw = row?.[column]
      if (raw === null || raw === undefined) return null
      const value = column === 'stage' ? raw : JSON.parse(raw)
      return { value, evidence: await evidenceStore.latest(modelId, field) }
    },
    call: deps.call ?? callModel,
    commit: async (plan: AcceptPlan) => {
      // 影子落点:接纳计划即时落 jsonl(崩溃窗口内也在场);真事务归切换票
      if (commitCtx !== null) {
        appendLine({ at: nowIso(), kind: 'plan', ...commitCtx, plan })
      }
    },
    env: deps.env ?? process.env,
  }
  const graph: VerificationGraph = makeVerificationGraph(graphDeps, saver)

  // ---- 单工作项:指纹 → 同守/重开/续跑三分支 → invoke → 记账 ----

  /** 线索身份键(去重/注册表查询共用单点,防三处拼接漂移)。 */
  const clueKey = (provider: string, modelKey: string): string => `${provider}|${modelKey}`

  async function runItem(clue: PendingClue & { provider: ModelProviderId }, row: ShadowRunRow | undefined, roundCache: Map<string, string>, snapshots: Map<string, { content: string; observedAt: string }>, registered: Set<string>, recheck = false): Promise<void> {
    const def = PROVIDERS[clue.provider]
    // 线索专属页恒在白名单(它是任务身份的一部分,注册与否都照常抓取/记失败——轮询
    // 瞬时败时线索一手页整条隐身会让图在缺出处页的白名单上跑出错终态)。其余注册页
    // 可读性 = 有新鲜快照(轮询是唯一刷新者,不在图内绕档位重抓):无快照的**剔除**
    // 而非记抓取失败——升级迁移(pages NULL)或 boot 轮与首轮轮询竞态时不至于以死
    // 白名单跑全图,failed 集与指纹也不被「暂不可用」污染。
    const ownUrls = clueOwnedUrls(def, clue)
    const sources = whitelistOf(def, clue).filter((s) => ownUrls.has(s.url) || !registered.has(s.url) || snapshots.has(s.url))
    const reads = new Map<string, ReadRecord>()
    const failed = new Set<string>()
    const observedAt = nowIso()
    for (const s of sources) {
      try {
        // 注册页复用轮询快照;线索自有页同轮跨线索只抓一次,失败仍可重试。
        const snapshot = snapshots.get(s.url)
        const hit = snapshot?.content ?? roundCache.get(s.url)
        const content = hit !== undefined ? hit : await deps.fetchText(s.url, 30_000)
        roundCache.set(s.url, content)
        reads.set(s.url, { role: s.role, content, observedAt: snapshot?.observedAt ?? observedAt })
      } catch {
        failed.add(s.url)
      }
    }
    const task: VerificationTask = { provider: clue.provider, clue, sources: sources.map((s) => ({ ...s, observedAt: reads.get(s.url)?.observedAt })) }
    // 调度指纹只锚线索专属页(clueOwnedUrls 单点;重核线索无线索页)——thread 身份
    // 不随共享注册页内容抖动(31 页白名单任一变动全 provider 重开的风暴由此剪除);
    // 共享页变化的重核走 source:role 指纹底册 + shadow_rechecks 通道(recheck=true
    // 对同指纹终态也强制重跑)。票 10/11 拿到影子期实测后再议收窄口径。
    const fingerprint = computeEvidenceFingerprint(
      task,
      new Map([...reads].filter(([url]) => ownUrls.has(url))),
      new Set([...failed].filter((url) => ownUrls.has(url))),
    )
    // 线索快照锚定注册表(重试期间任务恒定;账本 re-ingest 刷新 title/sourceUrl 不漂移进
    // 指纹三元组——snapshot 即该线索在影子域的任务身份)
    if (row !== undefined && row.fingerprint === fingerprint && row.state === 'terminal' && !recheck) return // 同指纹守终态(重核例外:官方资料变了就要重跑)
    if (row !== undefined && row.fingerprint !== fingerprint) await saver.deleteThread(row.thread_id) // 证据已变:旧 checkpoint 语义失效
    const threadId = `${clue.provider}|${clue.modelKey}|${fingerprint}`
    q.register.run({ provider: clue.provider, modelKey: clue.modelKey, occurredOn: clue.occurredOn, title: clue.title, sourceUrl: clue.sourceUrl, threadId, fingerprint, updatedAt: nowIso() })
    commitCtx = { provider: clue.provider, modelKey: clue.modelKey, threadId, fingerprint }
    prefetch = new Map([...reads].map(([url, r]) => [url, r.content]))
    const cfg = { configurable: { thread_id: threadId } }
    let exit: VerificationExit | null
    let graphFingerprint: string | null = null
    if (row !== undefined && row.state === 'running' && row.fingerprint === fingerprint) {
      // 重扫运行中线程:getState 三态(中断续跑 / 完成未记账采纳 / 空线程全新)
      const snap = await graph.getState(cfg)
      const values = snap.values as { exit?: VerificationExit | null; fingerprint?: string | null } | undefined
      const staleExit = values?.exit ?? null
      if (snap.next.length > 0) {
        const r = await graph.invoke(null, cfg)
        exit = r.exit
        graphFingerprint = r.fingerprint
      } else if (staleExit !== null) {
        exit = staleExit
      } else {
        const r = await graph.invoke({ task }, cfg)
        exit = r.exit
        graphFingerprint = r.fingerprint
      }
    } else {
      // 全新线程 / 退避重试(已完成线程带 input 重 invoke = 从头重跑)/ 指纹重开
      const r = await graph.invoke({ task }, cfg)
      exit = r.exit
      graphFingerprint = r.fingerprint
    }
    commitCtx = null
    const state = exit !== null && exit.kind !== 'error' ? 'terminal' : 'backoff'
    q.finish.run({ provider: clue.provider, modelKey: clue.modelKey, state, exitJson: JSON.stringify(exit), updatedAt: nowIso() })
    // graphFingerprint = 图内实际读取子集的指纹(与调度侧全量指纹同名不同值,票 10 取证对照用)
    appendLine({ at: nowIso(), kind: 'exit', provider: clue.provider, modelKey: clue.modelKey, threadId, fingerprint, graphFingerprint, exit })
  }

  // ---- 一轮(2h cron 在轮询后驱动):清理 → 重扫/摄取/重开检查,串行逐项 ----

  let scanning = false
  async function round(): Promise<void> {
    if (scanning) {
      console.warn('影子核验:上一轮仍在进行,跳过本轮')
      return
    }
    scanning = true
    try {
      // 终态线程 7 天清理:删 checkpoint 线程(注册表行保留 = 指纹底册);运行中/退避中
      // 不进此查询,永不清理(重扫要续跑)。已清理行打标防重复删。
      for (const row of q.cleanupCandidates.all(isoDaysAgo(THREAD_CLEANUP_DAYS))) {
        await saver.deleteThread(row.thread_id)
        q.markCleaned.run(row.provider, row.model_key)
      }
      // 摄取划界:首轮写 started_at 且只此一次——存量线索(first_seen 早于影子链启动)
      // 不进影子集(spec 附注:存量 35 条切换首轮进待裁决集,历史补证归 issues/12)
      let startedAt = q.metaGet.get('started_at')?.value
      if (startedAt === undefined) {
        startedAt = nowIso()
        q.metaSet.run('started_at', startedAt)
      }
      // 轮询是注册页唯一刷新者;快照过期/失败不在图内绕过档位重新抓取。
      const snapshots = new Map<string, { content: string; observedAt: string }>()
      const registered = new Set<string>()
      const statuses = await db.selectFrom('model_fetch_status').selectAll().execute()
      for (const status of statuses) {
        const def = PROVIDERS[status.provider as ModelProviderId]
        const role = status.role as SourceRole
        const source = def?.sources[role]
        if (source === undefined) continue
        for (const url of source.urls) registered.add(url)
        if (status.pages === null || status.last_success_at === null || sourceIsStale(role, status)) continue
        const pages = parseSourcePages(status.pages)
        for (const url of source.urls) if (pages[url] !== undefined && (snapshots.get(url)?.observedAt ?? '') < status.last_success_at) {
          snapshots.set(url, { content: pages[url], observedAt: status.last_success_at })
        }
        if (role === 'release' || status.fingerprint === null) continue
        // 底册 key 带形态版本:规范化器升级后首轮只建底册,不把翻转冒充资料变化
        const key = `source:${def.id}:${role}:v${FINGERPRINT_BASIS_VERSION}`
        const previous = q.metaGet.get(key)?.value
        // 首次成功只建指纹底册,不把种子补证批次提前到影子期。
        const models = previous !== undefined && previous !== status.fingerprint
          ? await db.selectFrom('model_archive').select(['id', 'official_id', 'name']).where('provider', '=', def.id).execute()
          : []
        // ponytail: 共享页变化重核该厂家全部模型;有真实成本数据后再按页面 scope 收窄。
        sqlite.transaction(() => {
          for (const model of models) sqlite.prepare(
            'INSERT INTO shadow_rechecks VALUES (?, ?, ?, ?, ?) ON CONFLICT (provider, model_key) DO NOTHING',
          ).run(def.id, `${RECHECK_KEY_PREFIX}${model.id}`, nowIso().slice(0, 10), `${model.official_id} (${model.name}) 官方资料变化重核`, def.sources.release.urls[0]!)
          q.metaSet.run(key, status.fingerprint!)
        })()
      }
      // 工作项:重扫优先(运行中/退避中——系统错误按退避窗重试,不受展示窗口限制)、
      // 重核队列次之(强制重跑)、摄取再次(first_seen 轴)、终态重开检查最后(ingest
      // 窗内;逐项同指纹即守)
      const seen = new Set<string>()
      const items: Array<{ clue: PendingClue & { provider: ModelProviderId }; recheck: boolean }> = []
      for (const row of q.nonTerminal.all()) {
        // seen 先占键再判退避:跳过的行也不许被摄取/重开通道把同一线索再拉进来跑。
        // 退避判据用 state 列(finish 时 backoff ⇔ error 出口,schema 已编码;坏
        // updated_at 视已过窗——重投后 finish 重写时间戳自愈,跳过则会永久卡死)。
        seen.add(clueKey(row.provider, row.model_key))
        if (row.state === 'backoff') {
          const age = Date.parse(row.updated_at)
          if (!Number.isNaN(age) && Date.now() - age < ERROR_RETRY_MS) continue
        }
        items.push({ clue: rowToClue(row), recheck: false })
      }
      for (const row of sqlite.prepare<[], ShadowRunRow>('SELECT * FROM shadow_rechecks').all()) {
        if (!seen.has(clueKey(row.provider, row.model_key))) {
          items.push({ clue: rowToClue(row), recheck: true })
          seen.add(clueKey(row.provider, row.model_key))
        }
      }
      for (const clue of await ledger.cluesFirstSeenSince(startedAt)) {
        if (!seen.has(clueKey(clue.provider, clue.modelKey))) items.push({ clue, recheck: false })
      }
      for (const row of q.terminalInWindow.all(dayCutoff(REOPEN_WINDOW_DAYS))) {
        if (!seen.has(clueKey(row.provider, row.model_key))) items.push({ clue: rowToClue(row), recheck: false })
      }
      const roundCache = new Map<string, string>()
      for (const { clue, recheck } of items) {
        try {
          await runItem(clue, q.get.get(clue.provider, clue.modelKey) ?? undefined, roundCache, snapshots, registered, recheck)
          sqlite.prepare('DELETE FROM shadow_rechecks WHERE provider = ? AND model_key = ?').run(clue.provider, clue.modelKey)
        } catch (e) {
          // 意外异常(非图出口):行留 running,下轮同线程续跑自愈;单线索失败不牵连整轮
          console.error(`影子核验(${clue.provider})线索 ${clue.modelKey} 轮次异常(下轮续跑):`, e)
        }
      }
    } catch (e) {
      // cron 驱动的 fire-and-forget 常例:轮自身永不向调用方抛错(清理/划界段异常记日志,
      // 下轮自愈),防止未处理 rejection
      console.error('影子核验轮次失败(下轮重试):', e)
    } finally {
      scanning = false
    }
  }

  return {
    round,
    /** 测试接缝:同 saver 同 deps 的图实例(断点续跑预播种/采纳分支预播种)。 */
    graph,
    /** 测试接缝:私有库连接(注册表/清理断言);先例 openDb 暴露 sqlite。 */
    sqlite,
    /**
     * 核验链状态(ADR-0062 决策五,archive 信封供数;只读查询不算「生产写」):影子期
     * 数据源 = 影子注册表(暂缓是新链出口,旧链/主库无此语义);切换(issues/11)后换
     * 生产库实现,wire 形态不变。terminal 行的 exit_json 坏行跳过不计数(读侧不因
     * 单行脏数据 500)。
     */
    chainStats: (): ModelVerificationChainStatus => {
      const rows = sqlite.prepare<[], { exit_json: string | null; updated_at: string }>(
        "SELECT exit_json, updated_at FROM shadow_runs WHERE state = 'terminal'",
      ).all()
      let lastSuccessAt: string | null = null
      let deferredCount = 0
      for (const row of rows) {
        try {
          const exit = JSON.parse(row.exit_json ?? 'null') as VerificationExit | null
          if (exit === null) continue
          if (exit.kind === 'defer') deferredCount += 1
          else if (lastSuccessAt === null || row.updated_at > lastSuccessAt) lastSuccessAt = row.updated_at
        } catch { /* 坏行不计 */ }
      }
      return { lastSuccessAt, deferredCount }
    },
    close: () => sqlite.close(),
  }
}

export type ShadowVerification = ReturnType<typeof makeShadowVerification>
