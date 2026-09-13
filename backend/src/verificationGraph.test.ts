import { describe, expect, it, vi } from 'vitest'
import { MemorySaver } from '@langchain/langgraph'
import type { FieldEvidence } from './evidence'
import type { PendingClue } from './providers/def'
import {
  PLACEHOLDER_MODEL_ID,
  VERIFICATION_BUDGET,
  makeVerificationGraph,
  verificationModels,
  type AcceptPlan,
  type VerificationDeps,
  type VerificationTask,
} from './verificationGraph'

// 核验图接缝测试(issues/04;spec 测试决策:只测外部行为——出口语义、提案结构、事务边界、
// 预算与环境自锁;不测图内部节点顺序)。全部依赖注入,零真网零真库。

const CLUE: PendingClue = {
  occurredOn: '2026-09-12',
  title: 'GLM-5.4 发布',
  sourceUrl: 'https://zhipu.ai/release',
  modelKey: 'glm-5.4',
}

const TASK: VerificationTask = {
  provider: 'zhipu',
  clue: CLUE,
  sources: [
    { role: 'release', url: 'https://zhipu.ai/release' },
    { role: 'catalog', url: 'https://zhipu.ai/catalog' },
  ],
}

const RELEASE_MD = '# 智谱发布\n\nGLM-5.4 发布:新一代旗舰。2026-09-12 正式发布,上下文 200K。\nGLM-5.4 已上线 API,输入 8 元/百万 tokens。\n'
const CATALOG_MD = '# 模型目录\n\nGLM-5.4 可通过 API 调用,输入 8 元/百万 tokens。\n'

const REL = 'https://zhipu.ai/release'
const CAT = 'https://zhipu.ai/catalog'
const PRI = 'https://zhipu.ai/pricing'
const PRICING_MD = '# 定价\n\nGLM-5.4:输入 8 元/百万 tokens。\n'

/** 逐字段提案 fixture(excerpt 均在对应原文中命中)。 */
const STAGE_FIELD = { field: 'stage', value: 'preview', sourceUrl: REL, excerpt: 'GLM-5.4 发布:新一代旗舰' }
const AVAIL_REL = { field: 'availability', value: ['api'], sourceUrl: REL, excerpt: 'GLM-5.4 已上线 API' }
const AVAIL_CAT = { field: 'availability', value: ['api'], sourceUrl: CAT, excerpt: 'GLM-5.4 可通过 API 调用' }
const RELEASED_FIELD = { field: 'released_at', value: '2026-09-12', sourceUrl: REL, excerpt: '2026-09-12 正式发布' }
/** 价格提案引 release 页 → 矩阵只认 pricing 信源 → 恒暂缓(发布页旧价是真实漂移源)。 */
const PRICING_FIELD = {
  field: 'pricing',
  value: { region: '中国大陆', effectiveFrom: null, entries: [{ text: '输入 8 元/百万 tokens', scope: null }] },
  sourceUrl: REL,
  excerpt: '输入 8 元/百万 tokens',
}
/** 价格提案引定价页(pricing 角色有权)→ 可裁决取代。 */
const PRICING_PAGE = { ...PRICING_FIELD, sourceUrl: PRI, excerpt: 'GLM-5.4:输入 8 元/百万 tokens' }

const readBoth = JSON.stringify({ action: 'read', urls: [REL, CAT] })
const finalProposal = (fields: unknown[]) =>
  JSON.stringify({ action: 'final', isNoise: false, officialId: 'glm-5.4', name: 'GLM-5.4', kind: 'text', summary: '新一代旗舰', matchAliases: ['glm-5.4'], fields })
const finalNoise = JSON.stringify({ action: 'final', isNoise: true, reason: '托管第三方模型' })
const reviewAgree = JSON.stringify({ agree: true, reason: '证据支撑' })
const reviewNo = JSON.stringify({ agree: false, reason: '引用不支撑该值' })

interface CallLog { model: string; system: string; user: string; timeoutMs?: number }

/** 顺序应答的 callModel 桩:按序消费 replies,记录每次调用(prompt 断言用)。 */
function seqCall(replies: Array<string | null | Error>) {
  const calls: CallLog[] = []
  const fn = vi.fn(async (model: string, _k: string, system: string, user: string, timeoutMs?: number) => {
    calls.push({ model, system, user, timeoutMs })
    const r = replies.length > 0 ? replies.shift()! : '{}'
    if (r instanceof Error) throw r
    return { content: r, resp: '' }
  })
  return { fn, calls }
}

/** 常规 deps:两信源可读、无既有档案、commit 记账。 */
function makeDeps(over: Partial<VerificationDeps> = {}) {
  const commitPlans: AcceptPlan[] = []
  return {
    deps: {
      fetchText: vi.fn(async (url: string) => (url === REL ? RELEASE_MD : CATALOG_MD)),
      listModels: vi.fn(async () => []),
      listEvidence: vi.fn(async () => []),
      fieldCurrent: vi.fn(async () => null),
      call: vi.fn(async () => ({ content: '{}', resp: '' })),
      commit: vi.fn(async (plan: AcceptPlan) => {
        commitPlans.push(plan)
      }),
      env: { AIHUBMIX_API_KEY: 'k', VERIFY_INVESTIGATE_LLM_MODEL: 'inv-model', VERIFY_REVIEW_LLM_MODEL: 'rev-model' },
      ...over,
    } satisfies VerificationDeps,
    commitPlans,
  }
}

describe('核验图:出口语义(四类全测,同一 graph.invoke 接缝)', () => {
  it('接纳(新模型插行):双段一致 + stage/availability 过硬 → 单事务计划落执行器;pricing 引发布页按矩阵暂缓', async () => {
    const { fn, calls } = seqCall([readBoth, finalProposal([STAGE_FIELD, AVAIL_REL, AVAIL_CAT, RELEASED_FIELD, PRICING_FIELD]), reviewAgree])
    const d = makeDeps({
      call: fn,
      // 白名单第三件(历史证据)进调查上下文:按 (模型,字段) 最新行投影
      listEvidence: vi.fn(async () => [{
        modelId: 99, field: 'pricing', sourceUrl: REL, observedAt: '2026-08-01T00:00:00Z', excerpt: '输入 4 元/百万 tokens',
        contentFingerprint: 'b'.repeat(64), ruleVersion: 'matrix-v1', decidedModel: 'x+y', decidedAt: '2026-08-01T00:01:00Z',
      }]),
    })
    const graph = makeVerificationGraph(d.deps)
    const result = await graph.invoke({ task: TASK })
    expect(calls[0]!.user).toContain('历史证据')
    expect(calls[0]!.user).toContain('99.pricing')
    expect(result.exit).toMatchObject({
      kind: 'accept',
      target: 'insert',
      fields: [
        { field: 'stage', decision: 'accept' },
        { field: 'availability', decision: 'accept' },
        { field: 'released_at', decision: 'accept' },
        { field: 'pricing', decision: 'defer' },
      ],
    })
    // 事务边界:执行器恰一次,拿到完整单据
    expect(d.deps.commit).toHaveBeenCalledTimes(1)
    const plan = d.commitPlans[0]!
    expect(plan.target).toEqual({
      kind: 'insert',
      row: {
        provider: 'zhipu',
        officialId: 'glm-5.4',
        name: 'GLM-5.4',
        kind: 'text',
        stage: 'preview',
        availability: ['api'],
        summary: '新一代旗舰',
        matchAliases: ['glm-5.4'],
        sources: [
          { title: 'zhipu.ai', url: REL },
          { title: 'zhipu.ai', url: CAT },
        ],
      },
    })
    // insert 路径证据行 modelId 为占位(执行器插行后重写);裁决模型 = 调查+复核
    const pricing = plan.fields.find((f) => f.field === 'pricing')!
    expect(pricing.decision).toBe('defer')
    expect(pricing.deferReason).toContain('pricing')
    for (const f of plan.fields) if (f.evidence !== undefined) expect(f.evidence.modelId).toBe(PLACEHOLDER_MODEL_ID)
    expect(plan.fields.find((f) => f.field === 'stage')!.evidence!.decidedModel).toBe('inv-model+rev-model')
    expect(plan.fields.find((f) => f.field === 'stage')!.evidence!.ruleVersion).toBe('matrix-v1')
    // 语义化事件:线索公告 updated + released + api 新增(availability 从无到有)
    expect(plan.events).toEqual([
      { kind: 'updated', occurredOn: '2026-09-12', title: 'GLM-5.4 发布', sourceUrl: REL },
      { kind: 'released', occurredOn: '2026-09-12', title: 'GLM-5.4 正式发布', sourceUrl: REL },
      { kind: 'api_available', occurredOn: '2026-09-12', title: 'GLM-5.4 API 可用', sourceUrl: REL },
    ])
    // 指纹在 state 上(票 05 消费)
    expect(result.fingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(calls.map((c) => c.model)).toEqual(['inv-model', 'inv-model', 'rev-model'])
    expect(calls.every((c) => c.timeoutMs === VERIFICATION_BUDGET.llmTimeoutMs)).toBe(true)
    expect(d.deps.fetchText).toHaveBeenCalledWith(REL, 30_000)
  })

  it('接纳(既有模型更新):提案 officialId 命中档案 → update 路径,证据行带真实 modelId,stage 取代 + availability 增量事件', async () => {
    const prevRow: FieldEvidence = {
      modelId: 7, field: 'stage', sourceUrl: REL, observedAt: '2026-08-01T00:00:00Z', excerpt: '旧值:preview',
      contentFingerprint: 'a'.repeat(64), ruleVersion: 'matrix-v1', decidedModel: 'x+y', decidedAt: '2026-08-01T00:01:00Z',
    }
    const { fn } = seqCall([
      JSON.stringify({ action: 'read', urls: [REL, CAT, PRI] }),
      finalProposal([
        { field: 'stage', value: 'ga', sourceUrl: REL, excerpt: 'GLM-5.4 发布:新一代旗舰' },
        AVAIL_REL,
        AVAIL_CAT,
        PRICING_PAGE,
      ]),
      reviewAgree,
    ])
    const fieldCurrent = vi.fn(async (_m: number, field: string) =>
      field === 'stage'
        ? { value: 'preview', evidence: prevRow }
        : field === 'availability'
          ? { value: ['first_party_app'], evidence: null }
          : field === 'pricing'
            ? { value: { region: '中国大陆', effectiveFrom: null, entries: [{ text: '输入 4 元/百万 tokens', scope: null }] }, evidence: prevRow }
            : null,
    )
    const d = makeDeps({
      call: fn,
      fetchText: vi.fn(async (url: string) => (url === REL ? RELEASE_MD : url === CAT ? CATALOG_MD : PRICING_MD)),
      listModels: vi.fn(async () => [{ modelId: 7, officialId: 'glm-5.4', name: 'GLM-5.4', stage: 'preview', matchAliases: ['glm-5.4'] }]),
      fieldCurrent,
    })
    const taskWithPricing: VerificationTask = { ...TASK, sources: [...TASK.sources, { role: 'pricing', url: PRI }] }
    const result = await makeVerificationGraph(d.deps).invoke({ task: taskWithPricing })
    expect(result.exit).toMatchObject({ kind: 'accept', target: 'update' })
    const plan = d.commitPlans[0]!
    expect(plan.target).toEqual({ kind: 'update', modelId: 7 })
    expect(plan.fields.find((f) => f.field === 'stage')).toMatchObject({ decision: 'supersede' })
    expect(plan.fields.find((f) => f.field === 'stage')!.evidence!.modelId).toBe(7)
    expect(plan.fields.find((f) => f.field === 'pricing')).toMatchObject({ decision: 'supersede' })
    // availability 当前 first_party_app,提案 api → api_available(增量);pricing 取代 → 价格动态(故事 7)
    expect(plan.events).toEqual([
      { kind: 'updated', occurredOn: '2026-09-12', title: 'GLM-5.4 发布', sourceUrl: REL },
      { kind: 'updated', occurredOn: '2026-09-12', title: 'GLM-5.4 价格更新', sourceUrl: PRI },
      { kind: 'api_available', occurredOn: '2026-09-12', title: 'GLM-5.4 API 可用', sourceUrl: REL },
    ])
  })

  it('噪音:调查判噪音 + 复核同意 → 出口噪音', async () => {
    const { fn } = seqCall([finalNoise, reviewAgree])
    const d = makeDeps({ call: fn })
    const result = await makeVerificationGraph(d.deps).invoke({ task: TASK })
    expect(result.exit).toEqual({ kind: 'noise', reason: '托管第三方模型' })
    expect(d.deps.commit).not.toHaveBeenCalled()
  })

  it('暂缓(证据不足):身份校验不过(kind 越值域)→ 整单暂缓,复核不烧调用', async () => {
    const bad = JSON.stringify({ action: 'final', isNoise: false, officialId: 'glm-5.4', name: 'GLM-5.4', kind: 'vibe', fields: [] })
    const { fn, calls } = seqCall([bad])
    const d = makeDeps({ call: fn })
    const result = await makeVerificationGraph(d.deps).invoke({ task: TASK })
    expect(result.exit).toMatchObject({ kind: 'defer', cause: 'insufficient' })
    expect(calls).toHaveLength(1)
    expect(d.deps.commit).not.toHaveBeenCalled()
  })

  it('暂缓(证据不足):availability 提案缺 catalog 佐证(必要非充分)→ 插行缺过硬 availability → 整单暂缓', async () => {
    const { fn } = seqCall([readBoth, finalProposal([STAGE_FIELD, AVAIL_REL, RELEASED_FIELD]), reviewAgree])
    const d = makeDeps({ call: fn })
    const result = await makeVerificationGraph(d.deps).invoke({ task: TASK })
    expect(result.exit).toMatchObject({ kind: 'defer', cause: 'insufficient' })
    expect((result.exit as { reason: string }).reason).toContain('availability')
    expect(d.deps.commit).not.toHaveBeenCalled()
  })

  it('暂缓(证据不足):既有模型提案全部裁决暂缓(价格引发布页)→ 无可落即整单暂缓', async () => {
    const { fn } = seqCall([readBoth, finalProposal([PRICING_FIELD]), reviewAgree])
    const d = makeDeps({
      call: fn,
      listModels: vi.fn(async () => [{ modelId: 7, officialId: 'glm-5.4', name: 'GLM-5.4', stage: 'ga', matchAliases: ['glm-5.4'] }]),
    })
    const result = await makeVerificationGraph(d.deps).invoke({ task: TASK })
    expect(result.exit).toMatchObject({ kind: 'defer', cause: 'insufficient' })
    expect((result.exit as { reason: string }).reason).toContain('pricing')
  })

  it('暂缓(复核分歧):复核不同意 → 终态暂缓,不落库', async () => {
    const { fn } = seqCall([readBoth, finalProposal([STAGE_FIELD, AVAIL_REL, AVAIL_CAT]), reviewNo])
    const d = makeDeps({ call: fn })
    const result = await makeVerificationGraph(d.deps).invoke({ task: TASK })
    expect(result.exit).toEqual({ kind: 'defer', cause: 'disagreement', reason: '复核分歧:引用不支撑该值' })
    expect(d.deps.commit).not.toHaveBeenCalled()
  })

  it('暂缓(复核分歧):噪音结论被复核推翻 → 同样暂缓(复核从严,漏报也有护栏)', async () => {
    const { fn } = seqCall([finalNoise, reviewNo])
    const d = makeDeps({ call: fn })
    const result = await makeVerificationGraph(d.deps).invoke({ task: TASK })
    expect(result.exit).toMatchObject({ kind: 'defer', cause: 'disagreement' })
  })

  it('系统错误:调查段网关 5xx → error(退避重试口径)', async () => {
    const { fn } = seqCall([Object.assign(new Error('gateway down'), { status: 502 })])
    const d = makeDeps({ call: fn })
    const result = await makeVerificationGraph(d.deps).invoke({ task: TASK })
    expect(result.exit).toMatchObject({ kind: 'error' })
  })

  it('系统错误:信源全败短路(白名单内全部抓取失败)→ error 且不把占位串喂给模型(无第二轮)', async () => {
    const { fn, calls } = seqCall([readBoth])
    const d = makeDeps({
      call: fn,
      fetchText: vi.fn(async () => {
        throw new Error('HTTP 404')
      }),
    })
    const result = await makeVerificationGraph(d.deps).invoke({ task: TASK })
    expect(result.exit).toMatchObject({ kind: 'error' })
    expect((result.exit as { reason: string }).reason).toContain('信源全败')
    expect(calls).toHaveLength(1) // 短路:全败后不再有下一轮 LLM 调用
    expect(d.deps.fetchText).toHaveBeenCalledTimes(2)
  })

  it('系统错误:执行器事务抛错 → error(重放由执行器幂等守卫)', async () => {
    const { fn } = seqCall([readBoth, finalProposal([STAGE_FIELD, AVAIL_REL, AVAIL_CAT]), reviewAgree])
    const d = makeDeps({
      call: fn,
      commit: vi.fn(async () => {
        throw new Error('SQLITE_BUSY')
      }),
    })
    const result = await makeVerificationGraph(d.deps).invoke({ task: TASK })
    expect(result.exit).toMatchObject({ kind: 'error' })
    expect((result.exit as { reason: string }).reason).toContain('落库事务失败')
    expect(d.deps.commit).toHaveBeenCalledTimes(1)
  })

  it('未配置 Key:error 且零 LLM 调用', async () => {
    const d = makeDeps({ env: {} })
    const result = await makeVerificationGraph(d.deps).invoke({ task: TASK })
    expect(result.exit).toMatchObject({ kind: 'error' })
    expect(d.deps.call).not.toHaveBeenCalled()
  })
})

describe('核验图:调查节点(受限读取器与引用核实)', () => {
  it('白名单外 URL 拒读(不达 fetchText),提示后正常收束', async () => {
    const evil = 'https://evil.example/steal'
    const { fn, calls } = seqCall([
      JSON.stringify({ action: 'read', urls: [evil, REL] }),
      finalNoise,
      reviewAgree,
    ])
    const d = makeDeps({ call: fn })
    const result = await makeVerificationGraph(d.deps).invoke({ task: TASK })
    expect(result.exit).toMatchObject({ kind: 'noise' })
    expect(d.deps.fetchText).toHaveBeenCalledTimes(1)
    expect(d.deps.fetchText).toHaveBeenCalledWith(REL, 30_000)
    expect(calls[1]!.user).toContain('不在可读清单,已拒绝')
  })

  it('编造引用(excerpt 不在已抓原文中)→ 引用丢弃,字段因证据不足暂缓', async () => {
    const fabricated = { field: 'stage', value: 'preview', sourceUrl: REL, excerpt: '这段话根本不在原文里' }
    const { fn } = seqCall([readBoth, finalProposal([fabricated, AVAIL_REL, AVAIL_CAT]), reviewAgree])
    const d = makeDeps({ call: fn })
    const result = await makeVerificationGraph(d.deps).invoke({ task: TASK })
    expect(result.exit).toMatchObject({ kind: 'defer', cause: 'insufficient' })
    expect((result.exit as { reason: string }).reason).toContain('stage')
  })

  it('读取去重 + 轮数上限:重复索要同页不重抓,轮数耗尽未出结论 → 暂缓(证据不足)', async () => {
    const { fn, calls } = seqCall([readBoth, readBoth, readBoth, readBoth])
    const d = makeDeps({ call: fn })
    const result = await makeVerificationGraph(d.deps).invoke({ task: TASK })
    expect(result.exit).toMatchObject({ kind: 'defer', cause: 'insufficient' })
    expect((result.exit as { reason: string }).reason).toContain('轮数达上限')
    expect(calls).toHaveLength(VERIFICATION_BUDGET.investigationRounds)
    expect(d.deps.fetchText).toHaveBeenCalledTimes(2)
  })
})

describe('核验图:复核节点(零工具,只看证据与提案)', () => {
  it('复核 prompt 含提案与引用证据,不含调查推理(提案路径 state 结构上无调查 reason)', async () => {
    const { fn, calls } = seqCall([readBoth, finalProposal([STAGE_FIELD, AVAIL_REL, AVAIL_CAT]), reviewAgree])
    const d = makeDeps({ call: fn })
    await makeVerificationGraph(d.deps).invoke({ task: TASK })
    const review = calls[2]!
    expect(review.model).toBe('rev-model')
    expect(review.user).toContain('调查提案')
    expect(review.user).toContain('glm-5.4')
    expect(review.user).toContain('GLM-5.4 发布:新一代旗舰') // 引用证据在场
    expect(review.system).not.toContain('调查员') // 复核系统提示与调查提示互异
  })
})

describe('核验图:模型配置自锁与预算', () => {
  it('各一单值环境键、自锁不降级:不可用(404)→ 暂缓而非换模型', async () => {
    const { fn, calls } = seqCall([Object.assign(new Error('model gone'), { status: 404 })])
    const d = makeDeps({ call: fn })
    const result = await makeVerificationGraph(d.deps).invoke({ task: TASK })
    expect(result.exit).toMatchObject({ kind: 'defer', cause: 'unavailable' })
    expect(calls.map((c) => c.model)).toEqual(['inv-model']) // 单值即链长 1,无候选链回退
  })

  it('复核模型不可用(429 限额)→ 暂缓(ADR:任一不可用即暂缓;free 渠道故障期暂缓堆积是取向成本)', async () => {
    const { fn } = seqCall([readBoth, finalProposal([STAGE_FIELD, AVAIL_REL, AVAIL_CAT]), Object.assign(new Error('quota'), { status: 429 })])
    const d = makeDeps({ call: fn })
    const result = await makeVerificationGraph(d.deps).invoke({ task: TASK })
    expect(result.exit).toMatchObject({ kind: 'defer', cause: 'unavailable' })
  })

  it('核验 LLM 调用传 120s 超时(其余消费者维持 60s 缺省),读取 30s', async () => {
    const { fn, calls } = seqCall([finalNoise, reviewAgree])
    const d = makeDeps({ call: fn })
    await makeVerificationGraph(d.deps).invoke({ task: TASK })
    expect(VERIFICATION_BUDGET.llmTimeoutMs).toBe(120_000)
    expect(calls.every((c) => c.timeoutMs === 120_000)).toBe(true)
  })

  it('缺省模型 = ADR 钉死家族(coding-glm-5.3-flash / gpt-5.5-free);纯空白键回退缺省、值去两端空白', () => {
    expect(verificationModels({})).toEqual({ investigate: 'coding-glm-5.3-flash', review: 'gpt-5.5-free' })
    expect(verificationModels({ VERIFY_INVESTIGATE_LLM_MODEL: ' ', VERIFY_REVIEW_LLM_MODEL: ' b ' })).toEqual({ investigate: 'coding-glm-5.3-flash', review: 'b' })
  })
})

describe('核验图:指纹与 checkpointer', () => {
  it('证据指纹确定性:同线索同信源内容重放不变,内容变化即变', async () => {
    const run = async (releaseMd: string) => {
      const { fn } = seqCall([readBoth, finalNoise, reviewAgree])
      const d = makeDeps({ call: fn, fetchText: vi.fn(async () => releaseMd) })
      const graph = makeVerificationGraph(d.deps)
      return (await graph.invoke({ task: TASK })).fingerprint
    }
    expect(await run(RELEASE_MD)).toBe(await run(RELEASE_MD))
    expect(await run(RELEASE_MD)).not.toBe(await run(`${RELEASE_MD}\n新增一行`))
  })

  it('checkpointer 注入即用:MemorySaver + thread_id 走同一 invoke 路径', async () => {
    const { fn } = seqCall([finalNoise, reviewAgree])
    const d = makeDeps({ call: fn })
    const graph = makeVerificationGraph(d.deps, new MemorySaver())
    const result = await graph.invoke({ task: TASK }, { configurable: { thread_id: 'clue-1|fp-1' } })
    expect(result.exit).toMatchObject({ kind: 'noise' })
  })

  it('断点续跑(spec 测试决策):investigate 完成后中断,同 thread_id 重 invoke 从复核续跑,调查不重烧', async () => {
    const { fn } = seqCall([readBoth, finalProposal([STAGE_FIELD, AVAIL_REL, AVAIL_CAT]), reviewAgree])
    const d = makeDeps({ call: fn })
    const graph = makeVerificationGraph(d.deps, new MemorySaver())
    const cfg = { configurable: { thread_id: 'clue-1|fp-resume' }, interruptBefore: ['recheck' as const] }
    const r1 = await graph.invoke({ task: TASK }, cfg)
    expect(r1.investigation).toMatchObject({ kind: 'proposal' }) // 调查已完成并 checkpoint
    expect(r1.exit).toBe(null)
    const r2 = await graph.invoke(null, { configurable: { thread_id: 'clue-1|fp-resume' } })
    expect(r2.exit).toMatchObject({ kind: 'accept' })
    // 调查段两次 invoke 合计恰 2 次调用(读取轮 + final)——续跑未重烧已完成节点
    expect(fn.mock.calls.filter((c) => c[0] === 'inv-model')).toHaveLength(2)
    expect(d.deps.fetchText).toHaveBeenCalledTimes(2) // 信源抓取同样未重烧
  })
})
