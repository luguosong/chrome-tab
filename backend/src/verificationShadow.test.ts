import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, type Db } from './db'
import { makeClueLedger } from './clueLedger'
import { clueOwnedUrls, makeShadowVerification, type ShadowVerification } from './verificationShadow'
import { ZHIPU_DEF } from './providers/zhipu'
import { ModelTrackingService } from './modelTracking'
import type { PendingClue } from './providers/def'
import { computeEvidenceFingerprint, type ReadRecord, type VerificationExit, type VerificationTask } from './verificationGraph'

/**
 * 核验链调度集成测试(spec 测试决策:复用 service 集成层接缝,测外部行为——cron 重扫/
 * 断点续跑/线程清理/写库事务/指纹重开/摄取面)。生产库走真 :memory: 库,fetch/call 全注入
 * 零真网;断点续跑与采纳分支用暴露的 graph 接缝预播种(崩溃形态经进程内不可表达,
 * checkpoint + 注册表 running 行即其持久化残迹)。issues/11 切换:出口断言面 =
 * 运行注册表(exit_json)+ 线索账本(终态 + 证据指纹)+ 生产四表(档案/事件/证据/线索)。
 */

const CLUE: PendingClue & { provider: 'zhipu' } = {
  provider: 'zhipu',
  occurredOn: '2026-09-12',
  title: 'GLM-5.4 发布',
  sourceUrl: 'https://docs.zhipu.com/glm-5-4',
  modelKey: 'glm-5.4',
}
const REL = ZHIPU_DEF.sources.release.urls[0]!
const DOC = CLUE.sourceUrl
const RELEASE_MD = '# 智谱发布\n\nGLM-5.4 发布:新一代旗舰。2026-09-12 正式发布,上下文 200K。\n'
const DOC_MD = '# GLM-5.4 文档\n\nGLM-5.4 已上线 API。\n'

interface CallLog { model: string; user: string }

interface Fixture {
  dir: string
  db: Db
  ledger: ReturnType<typeof makeClueLedger>
  shadow: ShadowVerification
  replies: Array<string | Error>
  pages: Record<string, string>
  calls: CallLog[]
  fetchText: (url: string, timeoutMs: number) => Promise<string>
}

const cleanups: Array<() => void> = []
afterEach(() => {
  vi.useRealTimers()
  cleanups.splice(0).forEach((f) => f())
})

function fixture(): Fixture {
  const dir = mkdtempSync(join(tmpdir(), 'shadow-verify-'))
  const { db } = openDb(':memory:')
  const replies: Array<string | Error> = []
  const pages: Record<string, string> = { [REL]: RELEASE_MD, [DOC]: DOC_MD }
  const calls: CallLog[] = []
  const fetchText = vi.fn(async (url: string) => {
    const p = pages[url]
    if (p === undefined) throw new Error(`HTTP 404 ${url}`)
    return p
  })
  const shadow = makeShadowVerification(
    db,
    {
      fetchText,
      call: vi.fn(async (model: string, _k: string, _s: string, user: string) => {
        calls.push({ model, user })
        const r = replies.length > 0 ? replies.shift()! : '{}'
        if (r instanceof Error) throw r
        return { content: r, resp: '' }
      }),
      env: { AIHUBMIX_API_KEY: 'k', VERIFY_INVESTIGATE_LLM_MODEL: 'inv-model', VERIFY_REVIEW_LLM_MODEL: 'rev-model' },
    },
    { checkpointDbPath: join(dir, 'verification.db') },
  )
  cleanups.push(() => {
    shadow.close()
    rmSync(dir, { recursive: true, force: true })
  })
  return { dir, db, ledger: makeClueLedger(db), shadow, replies, pages, calls, fetchText }
}

const readNoise = JSON.stringify({ action: 'read', urls: [REL] })
const finalNoise = JSON.stringify({ action: 'final', isNoise: true, reason: '托管第三方模型' })
const finalStage = JSON.stringify({
  action: 'final', isNoise: false, officialId: 'glm-5.4', name: 'GLM-5.4', kind: 'text',
  summary: '新一代旗舰', matchAliases: ['glm-5.4'],
  fields: [{ field: 'stage', value: 'ga', sourceUrl: REL, excerpt: 'GLM-5.4 发布:新一代旗舰' }],
})
const agree = JSON.stringify({ agree: true, reason: '证据支撑' })

/** 白名单:六类注册页 + 线索 sourceUrl(zhipu 无 verifyUrls → 缺省)。 */
const whitelistUrls = (): string[] => [...new Set([...Object.values(ZHIPU_DEF.sources).flatMap((s) => s.urls), CLUE.sourceUrl])]

/** 与 round() 同式的调度侧指纹(预播种 thread_id 用):锚定面经 clueOwnedUrls 单点
 *  (与 runItem 同源,口径收窄时测试不与实现错开)。 */
function schedulerFingerprint(fx: Fixture): string {
  const ownUrls = clueOwnedUrls(ZHIPU_DEF, CLUE)
  const reads = new Map<string, ReadRecord>()
  const failed = new Set<string>()
  for (const url of ownUrls) {
    if (fx.pages[url] === undefined) failed.add(url)
    else reads.set(url, { role: 'release', content: fx.pages[url]!, observedAt: '2026-09-13T00:00:00Z' })
  }
  const task: VerificationTask = { provider: 'zhipu', clue: CLUE, sources: [...ownUrls].map((url) => ({ role: 'release' as const, url })) }
  return computeEvidenceFingerprint(task, reads, failed)
}

const registryRow = (fx: Fixture, modelKey = CLUE.modelKey) =>
  fx.shadow.sqlite.prepare<[string, string], { state: string; thread_id: string; fingerprint: string; thread_cleaned: number; exit_json: string | null; updated_at: string }>(
    'SELECT state, thread_id, fingerprint, thread_cleaned, exit_json, updated_at FROM shadow_runs WHERE provider = ? AND model_key = ?',
  ).get(CLUE.provider, modelKey)

/** 注册表出口(jsonl 落点已随影子期退役;执行记录 = 注册表 exit_json)。 */
const registryExit = (fx: Fixture, modelKey = CLUE.modelKey): (VerificationExit & { threadId: string }) | null => {
  const row = registryRow(fx, modelKey)
  if (row === undefined || row.exit_json === null) return null
  return { ...(JSON.parse(row.exit_json) as VerificationExit), threadId: row.thread_id }
}

const clueState = async (fx: Fixture, modelKey = CLUE.modelKey) =>
  (await makeClueLedger(fx.db).clueRow('zhipu', modelKey))

const checkpointCount = (fx: Fixture, threadId: string): number =>
  (fx.shadow.sqlite.prepare('SELECT COUNT(*) AS c FROM checkpoints WHERE thread_id = ?').get(threadId) as { c: number }).c

/** 预播种 running 注册行(崩溃残迹形态:行在、记账未完成)。 */
const seedRunningRow = (fx: Fixture, threadId: string, fingerprint: string): void => {
  fx.shadow.sqlite
    .prepare(
      `INSERT INTO shadow_runs (provider, model_key, occurred_on, title, source_url, thread_id, fingerprint, state, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'running', ?)`,
    )
    .run(CLUE.provider, CLUE.modelKey, CLUE.occurredOn, CLUE.title, CLUE.sourceUrl, threadId, fingerprint, new Date().toISOString())
}

/** 既有档案行(insert/update 两路径共用夹具)。 */
const seedArchiveRow = async (fx: Fixture, stage = 'preview'): Promise<void> => {
  await fx.db.insertInto('model_archive').values({
    provider: 'zhipu', official_id: 'glm-5.4', name: 'GLM-5.4', kind: 'text', stage,
    availability: JSON.stringify(['first_party_app']), summary: null, sources: '[]',
    pricing: null, limits: null, training_params: null,
    match_aliases: JSON.stringify(['glm-5.4']), match_slugs: '[]', verified: 'manual',
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).execute()
}

describe('核验链:写库事务与出口记账(issues/11 切换)', () => {
  it('接纳(update 路径)单事务写库:档案列更新 + 事件 + 证据行 + 线索 accepted 带指纹', async () => {
    const fx = fixture()
    await seedArchiveRow(fx) // stage=preview → 提案 ga 走 supersede
    await fx.ledger.ingest('zhipu', [CLUE])
    fx.replies.push(readNoise, finalStage, agree)
    await fx.shadow.round()
    // 线索账本:accepted + 证据指纹(重开判定的比对基准)
    const clue = await clueState(fx)
    expect(clue).toMatchObject({ state: 'accepted' })
    expect(clue!.fingerprint).toMatch(/^[0-9a-f]{64}$/)
    // 档案列:stage 取代 preview → ga,updated_at 前移
    const row = await fx.db.selectFrom('model_archive').selectAll().executeTakeFirst()
    expect(row!.stage).toBe('ga')
    // 语义化事件:线索公告 updated + 弃/退无、availability 未提案无
    const events = await fx.db.selectFrom('model_events').selectAll().execute()
    expect(events.map((e) => e.kind)).toEqual(['updated'])
    expect(events[0]).toMatchObject({ occurred_on: CLUE.occurredOn, title: CLUE.title, source_url: CLUE.sourceUrl })
    // 证据行:append-only,stage 一行(supersede 首次补证)
    const evidence = await fx.db.selectFrom('model_field_evidence').selectAll().execute()
    expect(evidence).toHaveLength(1)
    expect(evidence[0]).toMatchObject({ field: 'stage', source_url: REL, excerpt: 'GLM-5.4 发布:新一代旗舰' })
    expect(registryRow(fx)).toMatchObject({ state: 'terminal' })
  })

  it('接纳(insert 路径)插行 verified=auto,证据行 modelId 重写为真行 id', async () => {
    const fx = fixture()
    await fx.ledger.ingest('zhipu', [CLUE])
    const finalInsert = JSON.stringify({
      action: 'final', isNoise: false, officialId: 'glm-5.4', name: 'GLM-5.4', kind: 'text',
      summary: null, matchAliases: ['glm-5.4'],
      fields: [
        { field: 'stage', value: 'ga', sourceUrl: REL, excerpt: 'GLM-5.4 发布:新一代旗舰' },
        // availability 不含 api:含 api 须另由 catalog 在场观察佐证(矩阵必要非充分证据,
        // 裁决直测见 adjudication.test;此处测插行落库本身)
        { field: 'availability', value: ['first_party_app'], sourceUrl: REL, excerpt: 'GLM-5.4 发布:新一代旗舰' },
      ],
    })
    fx.replies.push(readNoise, finalInsert, agree)
    await fx.shadow.round()
    const row = await fx.db.selectFrom('model_archive').selectAll().executeTakeFirst()
    expect(row).toMatchObject({ official_id: 'glm-5.4', stage: 'ga', verified: 'auto' })
    expect(JSON.parse(row!.availability)).toEqual(['first_party_app'])
    const evidence = await fx.db.selectFrom('model_field_evidence').selectAll().execute()
    expect(evidence).toHaveLength(2)
    for (const e of evidence) expect(e.model_id).toBe(row!.id) // 占位重写
    expect(await clueState(fx)).toMatchObject({ state: 'accepted' })
  })

  it('noise 出口记账账本(带指纹);defer 出口落 insufficient(终态待指纹变化)', async () => {
    const fx = fixture()
    await fx.ledger.ingest('zhipu', [CLUE])
    fx.replies.push(finalNoise, agree)
    await fx.shadow.round()
    expect(await clueState(fx)).toMatchObject({ state: 'noise' })
    expect((await clueState(fx))!.fingerprint).toMatch(/^[0-9a-f]{64}$/)
    // defer:复核不同意
    const fx2 = fixture()
    await fx2.ledger.ingest('zhipu', [CLUE])
    fx2.replies.push(finalStage, JSON.stringify({ agree: false, reason: '引用不支撑' }))
    await fx2.shadow.round()
    expect(await clueState(fx2)).toMatchObject({ state: 'insufficient' })
    expect((await clueState(fx2))!.fingerprint).toMatch(/^[0-9a-f]{64}$/)
  })

  it('error 出口不写账本(留 pending 退避重试);轮次异常行留 running 自愈', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-12T02:41:00Z'))
    const fx = fixture()
    try {
      await fx.ledger.ingest('zhipu', [CLUE])
      fx.replies.push(Object.assign(new Error('gateway down'), { status: 502 }))
      await fx.shadow.round()
      expect(registryRow(fx)).toMatchObject({ state: 'backoff' })
      expect(registryExit(fx)).toMatchObject({ kind: 'error' })
      expect(await clueState(fx)).toMatchObject({ state: 'pending', fingerprint: null })
    } finally {
      vi.useRealTimers()
    }
  })

  it('重核线索(recheck: 键)不在账本:accept 照常落档案面,记账落空不跳过', async () => {
    const fx = fixture()
    await seedArchiveRow(fx, 'ga')
    fx.shadow.sqlite
      .prepare('INSERT INTO shadow_rechecks VALUES (?, ?, ?, ?, ?)')
      .run('zhipu', 'recheck:1', '2026-09-13', 'glm-5.4 (GLM-5.4) 官方资料变化重核', REL)
    fx.replies.push(readNoise, finalStage, agree)
    await fx.shadow.round()
    const row = await fx.db.selectFrom('model_archive').selectAll().executeTakeFirst()
    expect(row!.stage).toBe('ga') // 提案 ga 同值 supersede:出处刷新
    expect(await fx.db.selectFrom('model_field_evidence').selectAll().execute()).toHaveLength(1)
    expect(await fx.db.selectFrom('model_events').selectAll().execute()).toHaveLength(1)
  })
})

describe('核验链:摄取面与指纹重开(账本为判据)', () => {
  it('账本未决集自然进入:存量 pending(不限 first_seen)入集;旧链终态行不入集', async () => {
    vi.useFakeTimers()
    const fx = fixture()
    try {
      vi.setSystemTime(new Date('2026-09-12T02:00:00Z'))
      await fx.ledger.ingest('zhipu', [CLUE]) // 存量(first_seen = 启动前,切换语义:照常入集)
      await fx.ledger.recordVerification('zhipu', 'old-rejected', 'rejected', '旧链裁决')
      // 旧链 rejected 行(指纹 NULL)在账本,但终态不在未决集
      vi.setSystemTime(new Date('2026-09-12T04:41:00Z'))
      fx.replies.push(finalNoise, agree)
      await fx.shadow.round()
      expect(registryExit(fx)).toMatchObject({ kind: 'noise' })
      expect(registryExit(fx)!.threadId).toContain('|glm-5.4|')
      const recheckRow = fx.shadow.sqlite.prepare<[string, string], { state: string }>(
        'SELECT state FROM shadow_runs WHERE provider = ? AND model_key = ?',
      ).get('zhipu', 'old-rejected')
      expect(recheckRow).toBeUndefined() // 旧链终态行未进工作集
    } finally {
      vi.useRealTimers()
    }
  })

  it('同指纹守终态(账本版,零新调用);线索自有页变化 → 重开新线程,旧 checkpoint 删除', async () => {
    const fx = fixture()
    await fx.ledger.ingest('zhipu', [CLUE])
    fx.replies.push(finalNoise, agree)
    await fx.shadow.round()
    const first = registryExit(fx)!
    // 同指纹:账本终态守卫,零新调用
    await fx.shadow.round()
    expect(fx.calls).toHaveLength(2)
    // 共享注册页(REL)内容变化:不翻调度指纹(重核走 shadow_rechecks 通道)——仍守终态
    fx.pages[REL] = `${RELEASE_MD}\n新增一行:GLM-5.4 价格调整。`
    await fx.shadow.round()
    expect(fx.calls).toHaveLength(2)
    // 线索自有页(DOC)内容变化:指纹变 → 账本重开 → 重裁决
    fx.pages[DOC] = `${DOC_MD}\nGLM-5.4 已开放权重。`
    fx.replies.push(finalNoise, agree)
    await fx.shadow.round()
    const second = registryExit(fx)!
    expect(second.threadId).not.toBe(first.threadId)
    expect(checkpointCount(fx, first.threadId)).toBe(0) // 旧线程 checkpoint 已删
    expect(checkpointCount(fx, second.threadId)).toBeGreaterThan(0)
    expect(registryRow(fx)).toMatchObject({ state: 'terminal' })
    expect(await clueState(fx)).toMatchObject({ state: 'noise' })
  })

  it('重核队列对账本终态强制重跑(forceReopen 先行,不被同指纹守卫拦)', async () => {
    const fx = fixture()
    await fx.ledger.ingest('zhipu', [CLUE])
    fx.replies.push(finalNoise, agree)
    await fx.shadow.round()
    expect(fx.calls).toHaveLength(2)
    // 同键入队(资料又变/上轮队列残留):线索指纹未变也须重跑——同指纹守卫只护自然重开
    fx.shadow.sqlite
      .prepare('INSERT INTO shadow_rechecks VALUES (?, ?, ?, ?, ?)')
      .run('zhipu', CLUE.modelKey, '2026-09-13', 'glm-5.4 (GLM-5.4) 官方资料变化重核', REL)
    fx.replies.push(finalNoise, agree)
    await fx.shadow.round()
    expect(fx.calls).toHaveLength(4)
    expect(registryRow(fx)).toMatchObject({ state: 'terminal' })
  })
})

describe('核验链:cron 重扫与断点续跑', () => {
  it('退避重扫:系统错误落 backoff,下轮同 thread_id 重新 invoke(重试不受展示窗口限制)', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-12T02:41:00Z'))
    const fx = fixture()
    try {
      await fx.ledger.ingest('zhipu', [CLUE])
      fx.replies.push(Object.assign(new Error('gateway down'), { status: 502 }))
      await fx.shadow.round()
      expect(registryRow(fx)).toMatchObject({ state: 'backoff' })
      expect(registryExit(fx)).toMatchObject({ kind: 'error' })
      // 线索滚出 7 天活动窗(occurred_on 09-12,now 09-20):重扫仍进行——系统错误退避
      // 不受展示窗口限制(spec 实现决策)
      vi.setSystemTime(new Date('2026-09-20T02:41:00Z'))
      fx.replies.push(finalNoise, agree)
      await fx.shadow.round()
      const exit = registryExit(fx)!
      expect(exit).toMatchObject({ kind: 'noise' })
      expect(registryRow(fx)).toMatchObject({ state: 'terminal' })
      expect(fx.calls).toHaveLength(3) // 重试整图重跑:1(失败轮)+ 2(噪音轮)
    } finally {
      vi.useRealTimers()
    }
  })

  it('断点续跑:运行中线程(崩溃残迹)同 thread_id 续跑,已完成节点(调查)不重烧', async () => {
    const fx = fixture()
    // 预播种崩溃残迹:调查完成、复核未跑即中断(checkpoint 落在 recheck 前)
    const fingerprint = schedulerFingerprint(fx)
    const threadId = `zhipu|${CLUE.modelKey}|${fingerprint}`
    fx.replies.push(finalNoise)
    const r1 = await fx.shadow.graph.invoke(
      { task: { provider: 'zhipu', clue: CLUE, sources: whitelistUrls().map((url) => ({ role: 'release' as const, url })) } },
      { configurable: { thread_id: threadId }, interruptBefore: ['recheck' as const] },
    )
    expect(r1.exit).toBe(null) // 调查完成,出口未定
    seedRunningRow(fx, threadId, fingerprint)
    await fx.ledger.ingest('zhipu', [CLUE])
    fx.replies.push(agree)
    await fx.shadow.round()
    // 调查恰 1 次(预播种),续跑只补复核 1 次——已完成节点未重烧
    expect(fx.calls.filter((c) => c.model === 'inv-model')).toHaveLength(1)
    expect(fx.calls.filter((c) => c.model === 'rev-model')).toHaveLength(1)
    expect(registryRow(fx)).toMatchObject({ state: 'terminal' })
    expect(registryExit(fx)).toMatchObject({ threadId, kind: 'noise' })
  })

  it('完成未记账采纳:invoke 已完成但记账前崩溃(running 残迹)→ 下轮采纳 exit,不再 invoke', async () => {
    const fx = fixture()
    const fingerprint = schedulerFingerprint(fx)
    const threadId = `zhipu|${CLUE.modelKey}|${fingerprint}`
    fx.replies.push(finalNoise, agree)
    await fx.shadow.graph.invoke(
      { task: { provider: 'zhipu', clue: CLUE, sources: whitelistUrls().map((url) => ({ role: 'release' as const, url })) } },
      { configurable: { thread_id: threadId } },
    )
    seedRunningRow(fx, threadId, fingerprint)
    await fx.ledger.ingest('zhipu', [CLUE])
    await fx.shadow.round()
    expect(fx.calls).toHaveLength(2) // 预播种的 2 次,本轮零新调用
    expect(registryRow(fx)).toMatchObject({ state: 'terminal' })
    expect(registryExit(fx)).toMatchObject({ threadId, kind: 'noise' })
  })
})

describe('核验链:调度修复(票 06 review)', () => {
  it('信源快照坏 JSON 行不炸轮:该行视为无快照(注册页剔除),线索照跑', async () => {
    const fx = fixture()
    // zhipu catalog 行:registered 但 pages 是截断写坏行——upgrade/手改后的真实形态
    await fx.db.insertInto('model_fetch_status').values({
      provider: 'zhipu', role: 'catalog', stale: 0, pages: '{"https://docs.zhipu.com', fingerprint: null,
      last_success_at: new Date().toISOString(), last_attempt_at: new Date().toISOString(),
    }).execute()
    await fx.ledger.ingest('zhipu', [CLUE])
    fx.replies.push(finalNoise, agree)
    await fx.shadow.round()
    expect(registryExit(fx)).toMatchObject({ kind: 'noise' }) // 轮次未被坏行抛断
    // 坏行无快照 → catalog URL 剔除出白名单(既不在可读清单也不在抓取失败)
    const catalogUrl = ZHIPU_DEF.sources.catalog.urls[0]!
    expect(fx.calls[0]!.user).not.toContain(catalogUrl)
  })

  it('无新鲜快照的注册页剔除出白名单:不在可读清单、不进抓取失败,线索自有页照读', async () => {
    const fx = fixture()
    // 升级迁移形态:release 行 registered 但 pages=NULL、无成功时间
    await fx.db.insertInto('model_fetch_status').values({
      provider: 'zhipu', role: 'release', stale: 0, pages: null, fingerprint: null,
      last_success_at: null, last_attempt_at: new Date().toISOString(),
    }).execute()
    await fx.ledger.ingest('zhipu', [CLUE])
    fx.replies.push(finalNoise, agree)
    await fx.shadow.round()
    const user = fx.calls[0]!.user
    expect(user).not.toContain(REL) // 暂不可用 ≠ 抓取失败:整条剔除,不引导 LLM 也不污染 failed/指纹
    expect(user).toContain(DOC) // 线索自有页(未注册)恒可读
    expect(registryExit(fx)).toMatchObject({ kind: 'noise' })
  })

  it('重核线索不内插 verifyUrls:modelKey 是注册表键非模型 ID,不产保证 404 的死链', async () => {
    const fx = fixture()
    const changelog = 'https://developers.openai.com/api/docs/changelog.md'
    fx.pages[changelog] = '# Changelog\n\n## September, 2026\n'
    fx.shadow.sqlite
      .prepare('INSERT INTO shadow_rechecks VALUES (?, ?, ?, ?, ?)')
      .run('openai', 'recheck:42', '2026-09-13', 'gpt-x (GPT-X) 官方资料变化重核', changelog)
    fx.replies.push(finalNoise, agree)
    await fx.shadow.round()
    const user = fx.calls[0]!.user
    expect(user).not.toContain('models/recheck:42') // 无 models/recheck:42.md 死链进可读清单(线索唯一键本身合法在场)
    const exit = fx.shadow.sqlite.prepare<[string, string], { exit_json: string }>(
      'SELECT exit_json FROM shadow_runs WHERE provider = ? AND model_key = ?',
    ).get('openai', 'recheck:42')!
    expect(JSON.parse(exit.exit_json)).toMatchObject({ kind: 'noise' })
  })

  it('error 出口按退避窗重投:6h 窗内跳过(不再每轮烧 LLM),过窗照常重试', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-12T02:41:00Z'))
    const fx = fixture()
    try {
      await fx.ledger.ingest('zhipu', [CLUE])
      fx.replies.push(Object.assign(new Error('gateway down'), { status: 502 }))
      await fx.shadow.round()
      expect(registryRow(fx)).toMatchObject({ state: 'backoff' })
      vi.setSystemTime(new Date('2026-09-12T04:41:00Z')) // +2h:退避窗内
      await fx.shadow.round()
      expect(fx.calls).toHaveLength(1) // 未重投
      vi.setSystemTime(new Date('2026-09-12T08:41:01Z')) // +6h 过窗
      fx.replies.push(finalNoise, agree)
      await fx.shadow.round()
      expect(registryExit(fx)).toMatchObject({ kind: 'noise' }) // 重投成功
    } finally {
      vi.useRealTimers()
    }
  })

  it('同 URL 双角色并存:anthropic overview.md 注册为 catalog 又被 verifyUrls 以 release 补充', async () => {
    const fx = fixture()
    const overview = 'https://platform.claude.com/docs/en/about-claude/models/overview.md'
    const releases = 'https://platform.claude.com/release-notes.md'
    fx.pages[overview] = '# Models\n\nFable 5.1 api available\n'
    fx.pages[releases] = '# Release notes\n'
    await fx.ledger.ingest('anthropic', [{
      occurredOn: '2026-09-12', title: 'Fable 5.1 released',
      sourceUrl: releases, modelKey: 'fable-5.1',
    }])
    fx.replies.push(finalNoise, agree)
    await fx.shadow.round()
    const user = fx.calls[0]!.user
    // 去重会吞掉 release 角色 → availability 观察在矩阵无权(只认 release/weights)→ 系统性暂缓
    expect(user).toContain(`- [catalog] ${overview}`)
    expect(user).toContain(`- [release] ${overview}`)
  })

  it('重核线索两通道同指纹:error 退避经 nonTerminal 重扫时 thread 不换(在途 checkpoint 不被误删)', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-13T00:00:00Z'))
    const fx = fixture()
    try {
      await seedArchiveRow(fx, 'ga')
      fx.shadow.sqlite
        .prepare('INSERT INTO shadow_rechecks VALUES (?, ?, ?, ?, ?)')
        .run('zhipu', 'recheck:1', '2026-09-13', 'glm-5.4 (GLM-5.4) 官方资料变化重核', REL)
      fx.replies.push(Object.assign(new Error('gateway down'), { status: 502 }))
      await fx.shadow.round() // recheck 通道首跑 error → backoff(recheck 行已消费)
      const recheckRow = () => fx.shadow.sqlite
        .prepare<[string, string], { state: string; thread_id: string }>('SELECT state, thread_id FROM shadow_runs WHERE provider = ? AND model_key = ?')
        .get('zhipu', 'recheck:1')!
      expect(recheckRow().state).toBe('backoff')
      vi.setSystemTime(new Date('2026-09-13T07:00:00Z')) // 过 6h 退避窗:nonTerminal 通道重扫
      fx.replies.push(finalNoise, agree)
      await fx.shadow.round()
      // 指纹锚定面经 clueOwnedUrls 单点推导:两通道(recheck 队列 / nonTerminal 重扫)同基准,
      // 同 thread_id 重 invoke——不分家则 deleteThread 击穿崩溃续跑自愈
      expect(registryExit(fx, 'recheck:1')!.threadId).toBe(recheckRow().thread_id)
      expect(recheckRow().state).toBe('terminal')
    } finally {
      vi.useRealTimers()
    }
  })

  it('24h 页变化为无发布线索的既有模型入重核队列，同页不烧 LLM，核验链复用快照', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-13T00:00:00Z'))
    const fx = fixture()
    await seedArchiveRow(fx, 'ga')
    let price = '价格 1 元'
    const fetchText = vi.fn(async (url: string) => url === ZHIPU_DEF.sources.pricing.urls[0] ? price : '官方资料')
    const svc = new ModelTrackingService(fx.db, { fetchText })
    await svc.pollProvider()
    await fx.shadow.round()
    expect(fx.calls).toHaveLength(0) // 首次观察不是变化，也不提前触发补证
    price = '价格 2 元'
    vi.setSystemTime(new Date('2026-09-13T02:00:00Z'))
    await svc.pollProvider()
    await fx.shadow.round()
    expect(fx.calls).toHaveLength(0) // 慢档尚未到期
    vi.setSystemTime(new Date('2026-09-14T00:00:00Z'))
    await svc.pollProvider()
    fx.replies.push(finalNoise, agree)
    await fx.shadow.round()
    const exit = fx.shadow.sqlite.prepare<[], { model_key: string; exit_json: string }>(
      'SELECT model_key, exit_json FROM shadow_runs WHERE state = \'terminal\'',
    ).get()!
    expect(exit.model_key).toMatch(/^recheck:/)
    expect(JSON.parse(exit.exit_json)).toMatchObject({ kind: 'noise' })
    expect(fx.fetchText).not.toHaveBeenCalled() // 所有注册页由轮询缓存供给
    await fx.shadow.round()
    expect(fx.calls).toHaveLength(2)
    expect(await fx.db.selectFrom('model_pending_clues').selectAll().execute()).toEqual([])
    expect(await fx.db.selectFrom('model_field_evidence').selectAll().execute()).toEqual([])
  })

  it('终态线程 7 天清理(注册表行保留);退避中线程同窗永不清理', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-12T02:41:00Z'))
    const fx = fixture()
    try {
      await fx.ledger.ingest('zhipu', [CLUE, { ...CLUE, modelKey: 'kimi-k3', title: 'Kimi K3 发布', sourceUrl: 'https://platform.moonshot.cn/docs/kimi-k3' }])
      fx.pages['https://platform.moonshot.cn/docs/kimi-k3'] = '# Kimi K3\n'
      fx.replies.push(finalNoise, agree, Object.assign(new Error('gateway down'), { status: 502 }))
      await fx.shadow.round()
      const terminal = registryExit(fx)!
      const backoffRow = fx.shadow.sqlite
        .prepare<[string], { thread_id: string }>('SELECT thread_id FROM shadow_runs WHERE model_key = ? AND state = \'backoff\'')
        .get('kimi-k3')!
      expect(registryRow(fx)?.state).toBe('terminal')
      // 两行均老于 7 天清理窗(轮时 09-21 → 界 09-14,老化到 09-12)
      const aged = new Date('2026-09-12T02:41:00Z').toISOString()
      fx.shadow.sqlite.prepare('UPDATE shadow_runs SET updated_at = ?').run(aged)
      vi.setSystemTime(new Date('2026-09-21T02:41:00Z'))
      fx.replies.push(Object.assign(new Error('gateway down'), { status: 502 }))
      await fx.shadow.round()
      // 终态:checkpoint 已删、打标、行保留
      expect(checkpointCount(fx, terminal.threadId)).toBe(0)
      const t = registryRow(fx)!
      expect(t.state).toBe('terminal')
      expect(t.thread_cleaned).toBe(1)
      // 清理打标不 bump updated_at(裁决时刻纯净:chainStats 的「最近成功裁决」取它,票 08)
      expect(t.updated_at).toBe(aged)
      // 退避中:同窗老仍未清理(重扫续跑依赖 checkpoint),且本轮照常重试
      expect(checkpointCount(fx, backoffRow.thread_id)).toBeGreaterThan(0)
      const b = fx.shadow.sqlite
        .prepare<[string], { state: string; thread_cleaned: number }>('SELECT state, thread_cleaned FROM shadow_runs WHERE model_key = ?')
        .get('kimi-k3')!
      expect(b).toMatchObject({ state: 'backoff', thread_cleaned: 0 })
      // 轮级正缓存:两线索共享厂家 release 页,两个工作轮(工作轮 + 老化重扫轮)各只实抓一次
      expect(vi.mocked(fx.fetchText).mock.calls.filter((c) => c[0] === REL)).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('核验链:核验链状态(数据健康 UI,票 08)', () => {
  /** 直插终态行(统计口径的输入面;round 落终态的行为归既有各测试)。 */
  const seedTerminal = (fx: Fixture, modelKey: string, exitJson: string, updatedAt: string): void => {
    fx.shadow.sqlite
      .prepare(
        `INSERT INTO shadow_runs (provider, model_key, occurred_on, title, source_url, thread_id, fingerprint, state, exit_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'terminal', ?, ?)`,
      )
      .run(CLUE.provider, modelKey, CLUE.occurredOn, CLUE.title, CLUE.sourceUrl, `t-${modelKey}`, `f-${modelKey}`, exitJson, updatedAt)
  }

  it('defer 计堆积、accept/noise 计最近成功;running 与坏行不计且不炸读侧', () => {
    const fx = fixture()
    seedTerminal(fx, 'm-defer-1', JSON.stringify({ kind: 'defer', cause: 'insufficient', reason: '证据不足' }), '2026-09-13T01:00:00Z')
    seedTerminal(fx, 'm-defer-2', JSON.stringify({ kind: 'defer', cause: 'disagreement', reason: '复核分歧' }), '2026-09-13T02:00:00Z')
    seedTerminal(fx, 'm-noise', JSON.stringify({ kind: 'noise', reason: '托管模型' }), '2026-09-13T03:00:00Z')
    seedTerminal(fx, 'm-accept', JSON.stringify({ kind: 'accept', target: 'update', fields: [] }), '2026-09-12T09:00:00Z')
    seedRunningRow(fx, 't-m-running', 'f-m-running') // 运行中:不进 terminal 查询面
    seedTerminal(fx, 'm-bad', '{oops', '2026-09-13T04:00:00Z') // 坏行:跳过不计数
    expect(fx.shadow.chainStats()).toEqual({ lastSuccessAt: '2026-09-13T03:00:00Z', deferredCount: 2 })
  })

  it('空注册表:尚未成功、零堆积(archive 信封缺省注入的同形态)', () => {
    const fx = fixture()
    expect(fx.shadow.chainStats()).toEqual({ lastSuccessAt: null, deferredCount: 0 })
  })
})
