import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, type Db } from './db'
import { makeClueLedger } from './clueLedger'
import { makeShadowVerification, type ShadowVerification } from './verificationShadow'
import { ZHIPU_DEF } from './providers/zhipu'
import { ModelTrackingService } from './modelTracking'
import type { PendingClue } from './providers/def'
import { computeEvidenceFingerprint, type ReadRecord, type VerificationTask } from './verificationGraph'

/**
 * 影子核验调度集成测试(issues/05;spec 测试决策:复用 service 集成层接缝,测外部行为——
 * cron 重扫/断点续跑/线程清理/影子零生产写/指纹重开/摄取边界)。生产读侧(档案/证据/事件)
 * 走真 :memory: 库,fetch/call 全注入零真网;断点续跑与采纳分支用暴露的 graph 接缝预播种
 * (崩溃形态经进程内不可表达,checkpoint + 注册表 running 行即其持久化残迹)。
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
    { checkpointDbPath: join(dir, 'verification.db'), jsonlPath: join(dir, 'shadow.jsonl') },
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

/** 与 round() 同式的调度侧指纹(预播种 thread_id 用):全部白名单信源预抓。 */
function schedulerFingerprint(fx: Fixture): string {
  const reads = new Map<string, ReadRecord>()
  const failed = new Set<string>()
  for (const url of whitelistUrls()) {
    if (fx.pages[url] === undefined) failed.add(url)
    else reads.set(url, { role: 'release', content: fx.pages[url]!, observedAt: '2026-09-13T00:00:00Z' })
  }
  const task: VerificationTask = { provider: 'zhipu', clue: CLUE, sources: whitelistUrls().map((url) => ({ role: 'release' as const, url })) }
  return computeEvidenceFingerprint(task, reads, failed)
}

const registryRow = (fx: Fixture) =>
  fx.shadow.sqlite.prepare<[string, string], { state: string; thread_id: string; fingerprint: string; thread_cleaned: number; exit_json: string | null }>(
    'SELECT state, thread_id, fingerprint, thread_cleaned, exit_json FROM shadow_runs WHERE provider = ? AND model_key = ?',
  ).get(CLUE.provider, CLUE.modelKey)

const checkpointCount = (fx: Fixture, threadId: string): number =>
  (fx.shadow.sqlite.prepare('SELECT COUNT(*) AS c FROM checkpoints WHERE thread_id = ?').get(threadId) as { c: number }).c

interface JsonlLine { at: string; kind: string; provider: string; modelKey: string; threadId: string; fingerprint: string; exit?: { kind: string }; plan?: { target: { kind: string } } }
const jsonl = (fx: Fixture): JsonlLine[] => readFileSync(join(fx.dir, 'shadow.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as JsonlLine)

/** 预播种 running 注册行(崩溃残迹形态:行在、记账未完成)。 */
const seedRunningRow = (fx: Fixture, threadId: string, fingerprint: string): void => {
  fx.shadow.sqlite
    .prepare(
      `INSERT INTO shadow_runs (provider, model_key, occurred_on, title, source_url, thread_id, fingerprint, state, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'running', ?)`,
    )
    .run(CLUE.provider, CLUE.modelKey, CLUE.occurredOn, CLUE.title, CLUE.sourceUrl, threadId, fingerprint, new Date().toISOString())
}

/** 常规两步:首轮写 started_at 划界,再摄取线索(严格边界:首见早于启动即存量,永不入影子集)。 */
async function markerThenIngest(fx: Fixture): Promise<void> {
  await fx.shadow.round()
  await fx.ledger.ingest('zhipu', [CLUE])
}

describe('影子核验:真流量摄取与零生产写', () => {
  it('接纳(update 路径)落 jsonl 双行(plan/exit),生产五表零写入,注册表终态', async () => {
    const fx = fixture()
    // 既有档案行(stage=preview → 提案 ga 走 supersede)
    await fx.db.insertInto('model_archive').values({
      provider: 'zhipu', official_id: 'glm-5.4', name: 'GLM-5.4', kind: 'text', stage: 'preview',
      availability: JSON.stringify(['first_party_app']), summary: null, sources: '[]',
      pricing: null, limits: null, training_params: null,
      match_aliases: JSON.stringify(['glm-5.4']), match_slugs: '[]', verified: 'manual',
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).execute()
    const snap = async () => ({
      archive: await fx.db.selectFrom('model_archive').selectAll().execute(),
      events: await fx.db.selectFrom('model_events').selectAll().execute(),
      evidence: await fx.db.selectFrom('model_field_evidence').selectAll().execute(),
      clues: await fx.db.selectFrom('model_pending_clues').selectAll().execute(),
      status: await fx.db.selectFrom('model_fetch_status').selectAll().execute(),
    })
    await markerThenIngest(fx) // 基线含已摄取线索(摄取是 fixture 动作,非影子链写)
    const before = await snap()
    fx.replies.push(readNoise, finalStage, agree)
    await fx.shadow.round()
    expect(await snap()).toEqual(before) // 影子零生产写
    const lines = jsonl(fx)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({ kind: 'plan', provider: 'zhipu', modelKey: 'glm-5.4', plan: { target: { kind: 'update' } } })
    expect(lines[1]).toMatchObject({ kind: 'exit', exit: { kind: 'accept' } })
    expect(lines[0]!.threadId).toBe(lines[1]!.threadId)
    expect(lines[1]!.fingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(registryRow(fx)).toMatchObject({ state: 'terminal' })
  })

  it('摄取划界:first_seen 早于影子链启动的存量线索不入集;启动后新见线索入集', async () => {
    vi.useFakeTimers()
    const fx = fixture()
    try {
      vi.setSystemTime(new Date('2026-09-12T02:00:00Z'))
      await fx.ledger.ingest('zhipu', [CLUE]) // 存量(first_seen 02:00 = 启动前)
      vi.setSystemTime(new Date('2026-09-12T02:41:00Z'))
      await fx.shadow.round() // 首轮:写 started_at(02:41),存量不入
      expect(registryRow(fx)).toBeUndefined()
      vi.setSystemTime(new Date('2026-09-12T04:41:00Z'))
      await fx.ledger.ingest('zhipu', [{ ...CLUE, modelKey: 'glm-5.5', sourceUrl: 'https://docs.zhipu.com/glm-5-5', title: 'GLM-5.5 发布' }])
      fx.replies.push(finalNoise, agree)
      await fx.shadow.round()
      const lines = jsonl(fx)
      expect(lines).toHaveLength(1)
      expect(lines[0]).toMatchObject({ modelKey: 'glm-5.5', exit: { kind: 'noise' } })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('影子核验:cron 重扫与断点续跑', () => {
  it('退避重扫:系统错误落 backoff,下轮同 thread_id 重新 invoke(重试不受展示窗口限制)', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-12T02:41:00Z'))
    const fx = fixture()
    try {
      await markerThenIngest(fx)
      fx.replies.push(Object.assign(new Error('gateway down'), { status: 502 }))
      await fx.shadow.round()
      expect(registryRow(fx)).toMatchObject({ state: 'backoff' })
      expect(jsonl(fx)[0]).toMatchObject({ kind: 'exit', exit: { kind: 'error' } })
      // 线索滚出 7 天活动窗(occurred_on 09-12,now 09-20):重扫仍进行——系统错误退避
      // 不受展示窗口限制(spec 实现决策)
      vi.setSystemTime(new Date('2026-09-20T02:41:00Z'))
      fx.replies.push(finalNoise, agree)
      await fx.shadow.round()
      const lines = jsonl(fx)
      expect(lines).toHaveLength(2)
      expect(lines[1]).toMatchObject({ exit: { kind: 'noise' } })
      expect(lines[1]!.threadId).toBe(lines[0]!.threadId) // 同指纹 → 同 thread_id 重 invoke
      expect(registryRow(fx)).toMatchObject({ state: 'terminal' })
      expect(fx.calls).toHaveLength(3) // 重试整图重跑:1(失败轮)+ 2(噪音轮)
    } finally {
      vi.useRealTimers()
    }
  })

  it('断点续跑:运行中线程(崩溃残迹)同 thread_id 续跑,已完成节点(调查)不重烧', async () => {
    const fx = fixture()
    await fx.shadow.round() // started_at 划界
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
    expect(jsonl(fx)[0]).toMatchObject({ threadId, exit: { kind: 'noise' } })
  })

  it('完成未记账采纳:invoke 已完成但记账前崩溃(running 残迹)→ 下轮采纳 exit,不再 invoke', async () => {
    const fx = fixture()
    await fx.shadow.round()
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
    expect(jsonl(fx)).toHaveLength(1)
    expect(jsonl(fx)[0]).toMatchObject({ threadId, exit: { kind: 'noise' } })
  })
})

describe('影子核验:指纹重开与线程清理', () => {
  it('24h 页变化为无发布线索的既有模型入重核队列，同页不烧 LLM，影子链复用快照', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-13T00:00:00Z'))
    const fx = fixture()
    await fx.db.insertInto('model_archive').values({
      provider: 'zhipu', official_id: 'glm-5.4', name: 'GLM-5.4', kind: 'text', stage: 'ga',
      availability: '["api"]', summary: null, sources: '[]', pricing: null, limits: null,
      training_params: null, match_aliases: '[]', match_slugs: '[]', verified: 'manual',
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).execute()
    let price = '价格 1 元'
    const fetchText = vi.fn(async (url: string) => url === ZHIPU_DEF.sources.pricing.urls[0] ? price : '官方资料')
    const svc = new ModelTrackingService(fx.db, { fetchText, env: {} })
    await svc.pollProvider()
    await fx.shadow.round()
    expect(fx.calls).toHaveLength(0) // 首次观察不是变化，也不提前启动补证
    price = '价格 2 元'
    vi.setSystemTime(new Date('2026-09-13T02:00:00Z'))
    await svc.pollProvider()
    await fx.shadow.round()
    expect(fx.calls).toHaveLength(0) // 慢档尚未到期
    vi.setSystemTime(new Date('2026-09-14T00:00:00Z'))
    await svc.pollProvider()
    fx.replies.push(finalNoise, agree)
    await fx.shadow.round()
    expect(jsonl(fx)).toHaveLength(1)
    expect(jsonl(fx)[0]).toMatchObject({ modelKey: expect.stringMatching(/^recheck:/), exit: { kind: 'noise' } })
    expect(fx.fetchText).not.toHaveBeenCalled() // 所有注册页由轮询缓存供给
    await fx.shadow.round()
    expect(fx.calls).toHaveLength(2)
    expect(await fx.db.selectFrom('model_pending_clues').selectAll().execute()).toEqual([])
    expect(await fx.db.selectFrom('model_field_evidence').selectAll().execute()).toEqual([])
  })

  it('同指纹守终态(不再 invoke);信源页内容变化 → 重开新线程,旧 checkpoint 删除', async () => {
    const fx = fixture()
    await markerThenIngest(fx)
    fx.replies.push(finalNoise, agree)
    await fx.shadow.round()
    const first = jsonl(fx)[0]!
    // 同指纹:守终态,零新调用零新行
    await fx.shadow.round()
    expect(jsonl(fx)).toHaveLength(1)
    expect(fx.calls).toHaveLength(2)
    // 指纹变化(信源页内容变化):重开
    fx.pages[REL] = `${RELEASE_MD}\n新增一行:GLM-5.4 价格调整。`
    fx.replies.push(finalNoise, agree)
    await fx.shadow.round()
    const lines = jsonl(fx)
    expect(lines).toHaveLength(2)
    expect(lines[1]!.threadId).not.toBe(first.threadId) // 新指纹 → 新线程
    expect(lines[1]!.fingerprint).not.toBe(first.fingerprint)
    expect(checkpointCount(fx, first.threadId)).toBe(0) // 旧线程 checkpoint 已删
    expect(checkpointCount(fx, lines[1]!.threadId)).toBeGreaterThan(0)
    expect(registryRow(fx)).toMatchObject({ state: 'terminal' })
  })

  it('终态线程 7 天清理(注册表行保留为指纹底册);退避中线程同窗永不清理', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-12T02:41:00Z'))
    const fx = fixture()
    try {
      await fx.shadow.round()
      await fx.ledger.ingest('zhipu', [CLUE, { ...CLUE, modelKey: 'kimi-k3', title: 'Kimi K3 发布', sourceUrl: 'https://platform.moonshot.cn/docs/kimi-k3' }])
      fx.replies.push(finalNoise, agree, Object.assign(new Error('gateway down'), { status: 502 }))
      await fx.shadow.round()
      const terminal = jsonl(fx).find((l) => l.modelKey === CLUE.modelKey)!
      const backoff = jsonl(fx).find((l) => l.modelKey === 'kimi-k3')!
      expect(registryRow(fx)?.state).toBe('terminal')
      // 两行均老于 7 天清理窗(轮时 09-21 → 界 09-14,老化到 09-12)
      const aged = new Date('2026-09-12T02:41:00Z').toISOString()
      fx.shadow.sqlite.prepare('UPDATE shadow_runs SET updated_at = ?').run(aged)
      vi.setSystemTime(new Date('2026-09-21T02:41:00Z'))
      fx.replies.push(Object.assign(new Error('gateway down'), { status: 502 }))
      await fx.shadow.round()
      // 终态:checkpoint 已删、打标、行保留(指纹底册)
      expect(checkpointCount(fx, terminal.threadId)).toBe(0)
      const t = registryRow(fx)!
      expect(t.state).toBe('terminal')
      expect(t.thread_cleaned).toBe(1)
      // 退避中:同窗老仍未清理(重扫续跑依赖 checkpoint),且本轮照常重试
      expect(checkpointCount(fx, backoff.threadId)).toBeGreaterThan(0)
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
