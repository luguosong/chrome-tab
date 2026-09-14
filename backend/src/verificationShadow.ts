import Database from 'better-sqlite3'
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { ModelProviderId, ModelVerificationChainStatus } from 'chrome-tab-shared'
import { makeEvidence } from './evidence'
import type { Db } from './db'
import { makeClueLedger } from './clueLedger'
import { PROVIDERS, parseSourcePages, insertAutoArchiveRow } from './modelTracking'
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
 * 核验链调度(CONTEXT.md「无人值守数据核验」;ADR-0062 调度与执行):把核验图
 * (verificationGraph.ts)挂上生产轨道——issues/05 影子期零生产写(结果只落 jsonl)已由
 * issues/11 切换终结:图内最终事务节点经注入执行器单事务写生产库(档案/动态/证据行/
 * 线索状态),noise/defer 出口由本调度记账线索账本(带证据指纹,同指纹守终态、指纹变化
 * 重开——取代旧链「终态不可覆盖 + 一次定终身」)。旧核验链(modelVerify.verifyClue 与
 * rejected/insufficient 触人出口)已整体退役,代码不留双路径。
 *
 * 线程生命周期(spec 实现决策):thread_id = 线索 + 证据指纹;SqliteSaver(sync)单机嵌入,
 * **checkpoint 仅执行进度**——本模块的私有 sqlite 文件(data/verification.db)持有 saver
 * 表与运行注册表(shadow_runs):注册表只管执行(thread/退避/清理),线索终态判据在
 * 线索账本(model_pending_clues,生产真相)。终态线程 7 天清理(checkpoint 膨胀控制),
 * 运行中/退避中永不清理(重扫要续跑)。
 *
 * 证据指纹(调度侧)= SHA-256(线索三元组 + 线索专属信源页内容):thread_id 须先于
 * invoke 可算且跨轮稳定,图内 reads 子集依赖 LLM 选择不满足;预抓页以缓存注入图内
 * fetchText(免双重抓取)。预抓全部失败不短路——图内按需重抓是真实的第二次机会。
 *
 * invoke 三分支(getState 实证,issues/05):中断线程带 input 重 invoke 会重置状态重启而非
 * 续跑——续跑必须 invoke(null);已完成线程带 input 重 invoke 从头重跑 = 退避重试语义;
 * next 空且 exit 非空 = 已完成未记账(invoke 返回与记账之间崩溃)→ 采纳不再 invoke。
 */

/** 核验链调度注入面(测试零真网;fetch/env/call 注入)。 */
export interface ShadowDeps {
  fetchText: (url: string, timeoutMs: number) => Promise<string>
  env?: NodeJS.ProcessEnv
  /** LLM 单次调用注入;缺省真 callModel(网关闸门在其内部)。 */
  call?: VerificationDeps['call']
}

export interface ShadowConfig {
  /** 私有 sqlite 文件路径(saver 表 + 运行注册表;与生产库隔离)。 */
  checkpointDbPath: string
}

/** 运行注册表行(shadow_runs;state 三值:running/backoff/terminal——只管执行,终态判据在线索账本)。 */
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
 * 语境已逝,不再重开。重开判据 = 线索专属页指纹 vs 账本裁决时落的 evidence_fingerprint
 * (同指纹守终态);共享注册页变化走 shadow_rechecks 逐模型强制重核。
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

/** error 与 defer(unavailable) 出口(系统失败,issues/14)重投退避窗 = 三个轮次:网关 5xx/
 *  超时/渠道限额类故障按此节奏重试;无窗的每 2h 重投会让持续失败的项无限烧 LLM(卡死
 *  模型 × 每轮 1-2 次真实调用)。429 日限额场景 6h 重试最晚第三投跨天,自愈足够。 */
const ERROR_RETRY_MS = 6 * 3600_000

/**
 * 指纹底册的存储形态版本:normalizeSourcePage/白名单语义升级时递增——新版本首轮只建
 * 底册不判变化,规范化器升级不冒充「官方资料变化」触发全量重核风暴(跨厂家同步 LLM
 * 尖峰)。旧版本 key 自然废弃不迁移。
 */
const FINGERPRINT_BASIS_VERSION = 2

const nowIso = () => new Date().toISOString()
const isoDaysAgo = (days: number) => new Date(Date.now() - days * 86400_000).toISOString()

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
 * 核验链调度器。返回 round()(一轮重扫,2h cron 在轮询后驱动;内部并发自守卫,
 * 重入即跳过)与 graph/sqlite(测试接缝:断点续跑预播种与注册表断言;生产不消费)。
 */
export function makeShadowVerification(db: Db, deps: ShadowDeps, config: ShadowConfig) {
  mkdirSync(dirname(config.checkpointDbPath), { recursive: true })
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

  // ---- 图装配(生产读侧 + 注入 fetch/call;commit = 图内最终事务,单事务写生产库)----

  /** 当前工作项的预抓缓存(轮次内串行,单槽即可)。 */
  let prefetch = new Map<string, string>()
  /** 当前工作项的调度指纹(commit 记账线索状态用——与 thread_id 同源)。 */
  let currentFingerprint = ''

  /** 档案列映射(fieldCurrent 同一张表;released_at/retired_at 无列——事件即存档形态)。 */
  const ARCHIVE_COLUMN: Partial<Record<string, string>> = {
    pricing: 'pricing', limits: 'limits', training_params: 'training_params', stage: 'stage', availability: 'availability',
  }

  /**
   * 接纳计划执行器(ADR-0062「图内最终事务节点」的生产实现,issues/11):线索状态 +
   * 证据行 append + 档案插行/列更新 + 语义化事件,单 SQLite 事务原子提交。幂等可重放
   * = 状态守卫(recordVerification false 即线索已完整记账,整单跳过)+ 冲突跳过
   * (插行/事件 onConflict doNothing);insert 路径证据行 modelId 为占位常量,插行取
   * id 后重写(证据内容指纹不含 modelId,重写安全)。
   */
  async function commitAcceptPlan(plan: AcceptPlan): Promise<void> {
    await db.transaction().execute(async (trx) => {
      const ledgerTx = makeClueLedger(trx)
      const evidenceTx = makeEvidence(trx)
      if (!(await ledgerTx.recordVerification(plan.provider, plan.clue.modelKey, 'accepted', undefined, currentFingerprint))) {
        // 落空两因:重核线索(recheck: 键)不在账本 → 照常落档案面;线索已被完整记账
        // (重放/人工抢先)→ 幂等守卫,整单跳过
        if (await ledgerTx.clueRow(plan.provider, plan.clue.modelKey) !== null) return
      }
      let modelId = plan.target.kind === 'insert' ? await insertAutoArchiveRow(trx, plan.target.row) : plan.target.modelId
      for (const l of plan.fields) {
        if (l.evidence !== undefined && l.decision !== 'defer') {
          // 同证据(内容指纹)已在库即不追加:重核路径无账本状态守卫,崩溃重放由此去重
          if (await evidenceTx.has(modelId, l.field, l.evidence.contentFingerprint)) continue
          await evidenceTx.append({ ...l.evidence, modelId })
        }
      }
      if (plan.target.kind === 'update') {
        const updates: Record<string, unknown> = {}
        for (const l of plan.fields) {
          if (l.decision === 'defer' || l.value === undefined) continue
          const column = ARCHIVE_COLUMN[l.field]
          if (column !== undefined) updates[column] = column === 'stage' ? l.value : JSON.stringify(l.value)
        }
        if (Object.keys(updates).length > 0) {
          await trx.updateTable('model_archive').set({ ...updates, updated_at: nowIso() }).where('id', '=', modelId).execute()
        }
      }
      for (const ev of plan.events) {
        await trx
          .insertInto('model_events')
          .values({ model_id: modelId, kind: ev.kind, occurred_on: ev.occurredOn, title: ev.title, source_url: ev.sourceUrl, created_at: nowIso() })
          .onConflict((oc) => oc.columns(['model_id', 'kind', 'occurred_on', 'source_url']).doNothing())
          .execute()
      }
    })
  }

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
    commit: (plan: AcceptPlan) => commitAcceptPlan(plan),
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
    // 对同指纹终态也强制重跑)。
    const fingerprint = computeEvidenceFingerprint(
      task,
      new Map([...reads].filter(([url]) => ownUrls.has(url))),
      new Set([...failed].filter((url) => ownUrls.has(url))),
    )
    // 终态判据 = 线索账本(生产真相,issues/11):同指纹守终态(重核例外:官方资料变了
    // 就要重跑);指纹已变即重开(pending 可再裁决)。影子期注册表行不再是判据——影子期
    // 裁决不落账本,切换首轮按新协议重跑属预期(35 条存量同路径自然消化,无迁移特判)。
    const clueRowLedger = await ledger.clueRow(clue.provider, clue.modelKey)
    if (clueRowLedger !== null && !recheck) {
      if (clueRowLedger.state !== 'pending' && clueRowLedger.state !== 'error' && clueRowLedger.fingerprint === fingerprint) return
      await ledger.reopenIfFingerprintChanged(clue.provider, clue.modelKey, fingerprint)
    }
    if (row !== undefined && row.fingerprint !== fingerprint) await saver.deleteThread(row.thread_id) // 证据已变:旧 checkpoint 语义失效
    const threadId = `${clue.provider}|${clue.modelKey}|${fingerprint}`
    q.register.run({ provider: clue.provider, modelKey: clue.modelKey, occurredOn: clue.occurredOn, title: clue.title, sourceUrl: clue.sourceUrl, threadId, fingerprint, updatedAt: nowIso() })
    currentFingerprint = fingerprint
    prefetch = new Map([...reads].map(([url, r]) => [url, r.content]))
    const cfg = { configurable: { thread_id: threadId } }
    let exit: VerificationExit | null
    if (row !== undefined && row.state === 'running' && row.fingerprint === fingerprint) {
      // 重扫运行中线程:getState 三态(中断续跑 / 完成未记账采纳 / 空线程全新)
      const snap = await graph.getState(cfg)
      const values = snap.values as { exit?: VerificationExit | null } | undefined
      const staleExit = values?.exit ?? null
      if (snap.next.length > 0) {
        exit = (await graph.invoke(null, cfg)).exit
      } else if (staleExit !== null) {
        exit = staleExit
      } else {
        exit = (await graph.invoke({ task }, cfg)).exit
      }
    } else {
      // 全新线程 / 退避重试(已完成线程带 input 重 invoke = 从头重跑)/ 指纹重开
      exit = (await graph.invoke({ task }, cfg)).exit
    }
    currentFingerprint = ''
    // defer(unavailable) 与 error 同走退避(issues/14):模型/渠道不可用是系统失败非线索
    // 裁决——终态行只能等指纹变化重开,渠道恢复等不来,free 复核撞日限的线索会永久漏核;
    // 退避重扫让「系统失败按退避策略持续重试」落回生命周期词条语义。
    const state = exit !== null && exit.kind !== 'error' && !(exit.kind === 'defer' && exit.cause === 'unavailable') ? 'terminal' : 'backoff'
    q.finish.run({ provider: clue.provider, modelKey: clue.modelKey, state, exitJson: JSON.stringify(exit), updatedAt: nowIso() })
    // 出口记账(线索账本,带证据指纹):noise / defer(insufficient|disagreement)为终态待指纹
    // 变化重开;accept 已在图内最终事务记账(commitAcceptPlan);error 与 defer(unavailable)
    // 不写——留 pending 由退避重扫重试,不受展示窗口限制。写不进(旧链终态行等)由
    // recordVerification 返回 false 表达,不抛错;真 DB 异常照轮次口径上抛记日志(下轮自愈)。
    if (exit !== null && exit.kind === 'noise') {
      await ledger.recordVerification(clue.provider, clue.modelKey, 'noise', exit.reason, fingerprint)
    } else if (exit !== null && exit.kind === 'defer' && exit.cause !== 'unavailable') {
      await ledger.recordVerification(clue.provider, clue.modelKey, 'insufficient', exit.reason, fingerprint)
    }
  }

  // ---- 一轮(2h cron 在轮询后驱动):清理 → 重扫/摄取/重开检查,串行逐项 ----

  let scanning = false
  async function round(): Promise<void> {
    if (scanning) {
      console.warn('核验链:上一轮仍在进行,跳过本轮')
      return
    }
    scanning = true
    try {
      // 终态线程 7 天清理:删 checkpoint 线程(注册表行保留);运行中/退避中
      // 不进此查询,永不清理(重扫要续跑)。已清理行打标防重复删。
      for (const row of q.cleanupCandidates.all(isoDaysAgo(THREAD_CLEANUP_DAYS))) {
        await saver.deleteThread(row.thread_id)
        q.markCleaned.run(row.provider, row.model_key)
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
        // 首次成功只建指纹底册,不把种子补证批次提前触发。
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
      // 重核队列次之(强制重跑)、未决集再次(账本 {pending, error} 全集——存量线索
      // 切换首轮自然进入,issues/11)、终态重开检查最后(账本指纹非空的终态行,窗内
      // 逐项重算指纹,同指纹即守)
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
          // 强制重跑 = 账本行无条件重置 pending(重核的线索指纹可能未变,等不来自然重开);
          // 重核键(recheck:)不在账本,forceReopen 落空即 no-op
          await ledger.forceReopen(row.provider as ModelProviderId, row.model_key)
          items.push({ clue: rowToClue(row), recheck: true })
          seen.add(clueKey(row.provider, row.model_key))
        }
      }
      for (const clue of await ledger.unresolvedClues()) {
        if (!seen.has(clueKey(clue.provider, clue.modelKey))) items.push({ clue, recheck: false })
      }
      for (const clue of await ledger.reopenCandidates(REOPEN_WINDOW_DAYS)) {
        if (!seen.has(clueKey(clue.provider, clue.modelKey))) items.push({ clue, recheck: false })
      }
      const roundCache = new Map<string, string>()
      for (const { clue, recheck } of items) {
        try {
          await runItem(clue, q.get.get(clue.provider, clue.modelKey) ?? undefined, roundCache, snapshots, registered, recheck)
          sqlite.prepare('DELETE FROM shadow_rechecks WHERE provider = ? AND model_key = ?').run(clue.provider, clue.modelKey)
        } catch (e) {
          // 意外异常(非图出口):行留 running,下轮同线程续跑自愈;单线索失败不牵连整轮
          console.error(`核验链(${clue.provider})线索 ${clue.modelKey} 轮次异常(下轮续跑):`, e)
        }
      }
    } catch (e) {
      // cron 驱动的 fire-and-forget 常例:轮自身永不向调用方抛错(清理/划界段异常记日志,
      // 下轮自愈),防止未处理 rejection
      console.error('核验链轮次失败(下轮重试):', e)
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
     * 核验链状态(ADR-0062 决策五,archive 信封供数):数据源 = 运行注册表的 terminal
     * 行(本链执行记录;暂缓是新链出口,旧链终态行不在面内)。terminal 行的 exit_json
     * 坏行跳过不计数(读侧不因单行脏数据 500)。
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
