import { describe, expect, it } from 'vitest'
import { openDb } from './db'
import { ModelTrackingService } from './modelTracking'
import { OPENAI_DEF } from './providers/openai'
import { ANTHROPIC_DEF } from './providers/anthropic'
import { ALIBABA_DEF, QWEN_RELEASES_URL } from './providers/alibaba'
import { ZHIPU_RELEASES_URL } from './providers/zhipu'
import type { PendingClue } from './providers/def'
import { parseLlmJson, validateDraft, verifyClue } from './modelVerify'
import { modelCandidates } from './translate'

/** 一条裸 ID 线索(openai changelog 口径)。 */
const ASTRA_CLUE: PendingClue = {
  occurredOn: '2026-09-03',
  title: 'gpt-6-astra:Released GPT-6 Astra, our most capable model.',
  sourceUrl: 'https://developers.openai.com/api/docs/changelog#sep-3',
  modelKey: 'gpt-6-astra',
}

/** 合法草稿(LLM 输出形态;回链域名与核验信源一致)。 */
const VALID_DRAFT = {
  officialId: 'gpt-6-astra',
  name: 'GPT-6 Astra',
  kind: 'text',
  stage: 'ga',
  availability: ['api'],
  summary: 'GPT-6 世代旗舰',
  sources: [{ title: '模型文档', url: 'https://developers.openai.com/api/docs/models/gpt-6-astra' }],
  pricing: null,
  limits: null,
  matchAliases: ['gpt-6-astra'],
}

const OPENAI_VERIFY_URLS = OPENAI_DEF.verifyUrls!(ASTRA_CLUE)

describe('auto 核验:LLM 输出解析与草稿护栏(纯函数)', () => {
  it('parseLlmJson:剥围栏与前后杂文;非 JSON 返回 null', () => {
    expect(parseLlmJson('```json\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(parseLlmJson('好的,结果如下:{"a":1} 以上。')).toEqual({ a: 1 })
    expect(parseLlmJson('不是 JSON')).toBeNull()
    expect(parseLlmJson('{}')).toEqual({})
  })

  it('validateDraft:合法草稿过;必填缺/枚举外/无 sources 拒收', () => {
    expect(validateDraft(VALID_DRAFT, OPENAI_VERIFY_URLS)).toEqual({ ...VALID_DRAFT })
    expect(validateDraft({ ...VALID_DRAFT, officialId: '' }, OPENAI_VERIFY_URLS)).toBeNull()
    expect(validateDraft({ ...VALID_DRAFT, kind: 'vibe' }, OPENAI_VERIFY_URLS)).toBeNull()
    expect(validateDraft({ ...VALID_DRAFT, stage: 'live' }, OPENAI_VERIFY_URLS)).toBeNull()
    expect(validateDraft({ ...VALID_DRAFT, availability: [] }, OPENAI_VERIFY_URLS)).toBeNull()
    expect(validateDraft({ ...VALID_DRAFT, sources: [] }, OPENAI_VERIFY_URLS)).toBeNull()
    // matchAliases 缺省回落 [officialId]
    expect(validateDraft({ ...VALID_DRAFT, matchAliases: [] }, OPENAI_VERIFY_URLS)!.matchAliases).toEqual(['gpt-6-astra'])
  })

  it('回链护栏:sources 全部指向信源外域名 → 拒收(防 LLM 编造链接)', () => {
    expect(validateDraft(VALID_DRAFT, OPENAI_VERIFY_URLS)).not.toBeNull()
    const offsite = { ...VALID_DRAFT, sources: [{ title: 'x', url: 'https://example.com/a' }] }
    expect(validateDraft(offsite, OPENAI_VERIFY_URLS)).toBeNull()
  })
})

describe('auto 核验:verifyClue(候选链与环境,零真网经注入)', () => {
  /** fetchText 桩:信源页恒 404(LLM 前的信源抓取全失败场景也能测 key 缺失早退)。 */
  const fetch404 = async (): Promise<string> => {
    throw new Error('HTTP 404')
  }

  it('未配置 Key:error 且不发起任何 LLM 调用', async () => {
    const r = await verifyClue(OPENAI_DEF, ASTRA_CLUE, fetch404, { AIHUBMIX_API_KEY: '' })
    expect(r).toMatchObject({ outcome: 'error' })
    expect((r as { reason: string }).reason).toContain('AIHUBMIX_API_KEY')
  })

  it('噪音谓词在 def 层:百炼托管第三方(kimi-k3)被 ALIBABA noiseClue 硬拦,openai 无谓词', () => {
    const hosted: PendingClue = { occurredOn: '2026-09-01', title: 'kimi-k3:上架', sourceUrl: 'https://help.aliyun.com/x', modelKey: 'kimi-k3' }
    expect(ALIBABA_DEF.noiseClue!(hosted)).toBe(true)
    const own: PendingClue = { ...hosted, modelKey: 'qwen3.9-preview', title: 'qwen3.9-preview:上架' }
    expect(ALIBABA_DEF.noiseClue!(own)).toBe(false)
    expect(OPENAI_DEF.noiseClue).toBeUndefined()
  })

  it('anthropic 核验信源:固定抓 models/overview 页 + 线索源页(spec 1.3 裁决 12,URL 字面量钉死)', async () => {
    const clue: PendingClue = {
      occurredOn: '2026-09-04',
      title: "We've launched Claude Fable 5.1",
      sourceUrl: 'https://platform.claude.com/docs/en/models/fable-5-1/whats-new-fable-5-1',
      modelKey: 'https://platform.claude.com/docs/en/models/fable-5-1/whats-new-fable-5-1',
    }
    const fetched: string[] = []
    const r = await verifyClue(
      ANTHROPIC_DEF,
      clue,
      async (url) => {
        fetched.push(url)
        return '# Models'
      },
      { AIHUBMIX_API_KEY: 'test-key' },
      async () => ({ content: JSON.stringify({ isNoise: true, reason: 'x', draft: null }), resp: '' }),
    )
    expect(r).toMatchObject({ outcome: 'reject' }) // 判定结果无关紧要,只验信源抓取面
    expect(fetched).toEqual(['https://platform.claude.com/docs/en/about-claude/models/overview.md', clue.sourceUrl])
  })

  it('判自家但草稿校验不过 → insufficient(不再伪装 reject;reason 透传 LLM 判据)', async () => {
    // spec 1.5 裁决 7:「判别」与「草稿抽取」解耦——isNoise:false + 畸形草稿 = 信源证据
    // 不足,不是判错;Fable 5.1 误拒归因的结构点位(基线回放 #39 复现)。
    const llm = JSON.stringify({ isNoise: false, reason: '自家新模型但信源未给规格', draft: { ...VALID_DRAFT, kind: 'vibe' } })
    const r = await verifyClue(OPENAI_DEF, ASTRA_CLUE, async () => '# docs', { AIHUBMIX_API_KEY: 'k' }, async () => ({ content: llm, resp: '' }))
    expect(r).toMatchObject({ outcome: 'insufficient', reason: '自家新模型但信源未给规格' })
  })
})

describe('auto 核验:固定强模型(VERIFY_LLM_MODEL 单值不降级,票 07 裁决 11)', () => {
  const fetchOk = async (): Promise<string> => '原文'

  it('env 有键:单值即链长 1,可换路错误也不降级', async () => {
    const called: string[] = []
    const call = async (model: string) => {
      called.push(model)
      throw Object.assign(new Error('模型不存在'), { status: 404 }) // 可换路错误:链上还有候选才会换下一个
    }
    const r = await verifyClue(OPENAI_DEF, ASTRA_CLUE, fetchOk, { AIHUBMIX_API_KEY: 'k', VERIFY_LLM_MODEL: ' glm-5.3 ' }, call)
    expect(called).toEqual(['glm-5.3']) // trim 后单值;404 也不换候选 = 不降级
    expect(r).toMatchObject({ outcome: 'error' }) // 全候选失效(链长 1,即它自己)
  })

  it('无键/空串/纯空白:回退译制候选链(dev/测试零配置形态)', async () => {
    const called: string[] = []
    const call = async (model: string) => {
      called.push(model)
      throw Object.assign(new Error('key 无效'), { status: 401 }) // 不可换路:首候选即 error,单次调用即可断言链头
    }
    const envs: Array<NodeJS.ProcessEnv> = [
      { AIHUBMIX_API_KEY: 'k' },
      { AIHUBMIX_API_KEY: 'k', VERIFY_LLM_MODEL: '' }, // compose 透传行对 .env 缺键注入 ''(非 undefined)
      { AIHUBMIX_API_KEY: 'k', VERIFY_LLM_MODEL: '   ' },
    ]
    for (const env of envs) await verifyClue(OPENAI_DEF, ASTRA_CLUE, fetchOk, env, call)
    const head = modelCandidates({})[0]
    expect(called).toEqual([head, head, head])
  })
})

describe('auto 核验:service 集成(线索 → auto 行 + 事件 + 状态,零真网)', () => {
  /** 基线外新块(基线无 glm-9.9 → 线索)。 */
  const GLM99_MD = '<Update label="2026-9-9" description="GLM-9.9 未来旗舰模型上线">\n[**GLM-9.9**](/cn/guide/models/text/glm-9.9)\n</Update>'

  function makeDeps(llmContent: string) {
    return {
      fetchText: async (url: string) => {
        if (url === ZHIPU_RELEASES_URL) return GLM99_MD
        if (url === 'https://docs.bigmodel.cn/cn/guide/models/text/glm-9.9') return '# GLM-9.9\n1M 上下文'
        throw new Error('HTTP 404')
      },
      env: { AIHUBMIX_API_KEY: 'test-key', LLM_MIN_REQUEST_INTERVAL_MS: '1' },
      callModel: async () => ({ content: llmContent, resp: '' }),
    } satisfies import('./modelTracking').ModelTrackingDeps
  }

  it('accept:基线外线索 → auto 行入库 + updated 事件(标题=线索)+ 线索 accepted(读侧滚出)', async () => {
    const llm = JSON.stringify({
      isNoise: false,
      reason: '智谱自家新旗舰',
      draft: {
        officialId: 'glm-9.9',
        name: 'GLM-9.9',
        kind: 'text',
        stage: 'ga',
        availability: ['api'],
        summary: '未来旗舰模型',
        sources: [{ title: '模型文档', url: 'https://docs.bigmodel.cn/cn/guide/models/text/glm-9.9' }],
        pricing: null,
        limits: null,
        matchAliases: ['GLM-9.9'],
      },
    })
    const { db } = openDb(':memory:')
    const svc = new ModelTrackingService(db, makeDeps(llm), '')
    await svc.init()
    await svc.pollProvider('zhipu')
    const a = await svc.archive()
    const glm99 = a.models.find((m) => m.officialId === 'glm-9.9')
    expect(glm99).toMatchObject({ verified: 'auto', name: 'GLM-9.9', stage: 'ga' })
    expect(glm99!.events.some((e) => e.kind === 'updated' && e.title.includes('GLM-9.9'))).toBe(true)
    expect(a.pendingClues.some((c) => c.title.includes('GLM-9.9'))).toBe(false) // accepted 不再待办
  })

  it('accept 原子性:动态写失败时档案与 accepted 一并回滚', async () => {
    const llm = JSON.stringify({
      isNoise: false,
      reason: '智谱自家新旗舰',
      draft: {
        officialId: 'glm-9.9', name: 'GLM-9.9', kind: 'text', stage: 'ga', availability: ['api'], summary: '未来旗舰模型',
        sources: [{ title: '模型文档', url: 'https://docs.bigmodel.cn/cn/guide/models/text/glm-9.9' }],
        pricing: null, limits: null, matchAliases: ['GLM-9.9'],
      },
    })
    const { sqlite, db } = openDb(':memory:')
    sqlite.exec(`CREATE TRIGGER fail_glm99_event BEFORE INSERT ON model_events
      WHEN NEW.title LIKE '%GLM-9.9%' BEGIN SELECT RAISE(FAIL, 'fixture event insert failure'); END`)
    const svc = new ModelTrackingService(db, makeDeps(llm), '')
    await svc.pollProvider('zhipu')
    expect(await db.selectFrom('model_archive').select('id').where('official_id', '=', 'glm-9.9').executeTakeFirst()).toBeUndefined()
    const clue = await db.selectFrom('model_pending_clues').select('verify_state').executeTakeFirstOrThrow()
    expect(clue.verify_state).toBeNull()
  })

  it('reject(LLM 判噪音):线索 rejected 留表触人(读侧可见),无档案行;判定理由落库', async () => {
    const llm = JSON.stringify({ isNoise: true, reason: '平台功能条目', draft: null })
    const { db } = openDb(':memory:')
    const svc = new ModelTrackingService(db, makeDeps(llm), '')
    await svc.init()
    await svc.pollProvider('zhipu')
    const a = await svc.archive()
    expect(a.models.some((m) => m.officialId === 'glm-9.9')).toBe(false)
    expect(a.pendingClues.some((c) => c.title.includes('GLM-9.9'))).toBe(true) // 待人工
    // spec 1.4:reason 落库——误拒发生时可归因是判别问题还是信源问题
    const row = await db.selectFrom('model_pending_clues').select(['verify_state', 'verify_reason']).executeTakeFirstOrThrow() // 库内唯一线索(GLM-9.9;智谱 model_key=文档链接全串,不拿 key 断言)
    expect(row.verify_state).toBe('rejected')
    expect(row.verify_reason).toBe('平台功能条目')
  })

  it('同线索不复核:第二轮 poll 不再调 LLM(verify_state 已定)', async () => {
    const llm = JSON.stringify({ isNoise: true, reason: 'x', draft: null })
    const deps = makeDeps(llm)
    let calls = 0
    deps.callModel = async () => {
      calls++
      return { content: llm, resp: '' }
    }
    const { db } = openDb(':memory:')
    const svc = new ModelTrackingService(db, deps, '')
    await svc.init()
    await svc.pollProvider('zhipu')
    const first = calls
    await svc.pollProvider('zhipu')
    expect(calls).toBe(first) // rejected 不重试
  })

  it('noise 出口:noiseClue 硬拦托管第三方 → noise 态不触人、零 LLM 调用(issues/06 验收项)', async () => {
    // 行日期动态取今天(核验窗 7 天:写死日期会在一周后出窗,线索不进核验——假绿)
    const bailian = `<table>
<tr><th>模型类型</th><th>时间</th><th>模型ID</th><th>功能说明</th></tr>
<tr><td>文本生成</td><td>${new Date().toISOString().slice(0, 10)}</td><td><p><code>kimi-k3</code></p></td><td>第三方托管模型,不认领</td></tr>
</table>`
    let calls = 0
    const deps = {
      fetchText: async (url: string) => {
        if (url === QWEN_RELEASES_URL) return bailian
        throw new Error('HTTP 404')
      },
      env: { AIHUBMIX_API_KEY: 'test-key', LLM_MIN_REQUEST_INTERVAL_MS: '1' },
      callModel: async (): Promise<{ content: string | null; resp: string }> => {
        calls++
        return { content: '', resp: '' }
      },
    } satisfies import('./modelTracking').ModelTrackingDeps
    const { db } = openDb(':memory:')
    const svc = new ModelTrackingService(db, deps, '')
    await svc.init()
    await svc.pollProvider('alibaba')
    // 状态直查:noise 态而非 NULL(若谓词回归放行,callModel 被调后状态不是 noise)
    const row = await db
      .selectFrom('model_pending_clues')
      .selectAll()
      .where('model_key', '=', 'kimi-k3')
      .executeTakeFirst()
    expect(row?.verify_state).toBe('noise')
    const a = await svc.archive()
    expect(a.pendingClues.some((c) => c.title.includes('kimi-k3'))).toBe(false) // 读侧不触人(徽标不占)
    expect(calls).toBe(0)
  })

  it('error 落表可观测:核验链失败 → 行 error 态 + reason;下轮核验窗仍含(重试);徽标不含(不触人)', async () => {
    // spec 1.2:现状只 console.warn 不落表,核验链断没断不可见;落表后保持重试语义。
    const deps = makeDeps('')
    let calls = 0
    deps.callModel = async () => {
      calls++
      throw Object.assign(new Error('网关超时'), { status: 401 }) // 不可换路:首候选即 error 出口
    }
    const { db } = openDb(':memory:')
    const svc = new ModelTrackingService(db, deps, '')
    await svc.init()
    await svc.pollProvider('zhipu')
    const row = await db.selectFrom('model_pending_clues').select(['verify_state', 'verify_reason']).executeTakeFirstOrThrow() // 库内唯一线索(GLM-9.9;智谱 model_key=文档链接全串,不拿 key 断言)
    expect(row.verify_state).toBe('error')
    expect(row.verify_reason).toContain('网关超时')
    expect((await svc.archive()).pendingClues.some((c) => c.title.includes('GLM-9.9'))).toBe(false) // error 不触人
    await svc.pollProvider('zhipu') // 等一轮落定(init 内含不被等待的首轮,绝对计数会撞竞态)
    const first = calls
    await svc.pollProvider('zhipu')
    expect(calls).toBeGreaterThan(first) // 与 rejected 不重试对照:核验窗含 error,下轮重试
  })

  it('insufficient:判自家但草稿校验不过 → 触人(徽标含)+ 不重试(核验窗不含)+ reason 落库', async () => {
    // spec 1.5 裁决 7:留表 + 触人(等人工裁决)+ 一次定终身不重试(信源 7 天窗内
    // 更新概率低,重试 = 每轮烧强模型看同一页)。草稿 kind 越界 → validateDraft null。
    const llm = JSON.stringify({
      isNoise: false,
      reason: '自家新模型但信源未给规格',
      draft: {
        officialId: 'glm-9.9', name: 'GLM-9.9', kind: 'vibe', stage: 'ga', availability: ['api'], summary: 'x',
        sources: [{ title: '模型文档', url: 'https://docs.bigmodel.cn/cn/guide/models/text/glm-9.9' }],
        pricing: null, limits: null, matchAliases: ['GLM-9.9'],
      },
    })
    const deps = makeDeps(llm)
    let calls = 0
    deps.callModel = async () => {
      calls++
      return { content: llm, resp: '' }
    }
    const { db } = openDb(':memory:')
    const svc = new ModelTrackingService(db, deps, '')
    await svc.init()
    await svc.pollProvider('zhipu')
    const row = await db.selectFrom('model_pending_clues').select(['verify_state', 'verify_reason']).executeTakeFirstOrThrow() // 库内唯一线索(GLM-9.9;智谱 model_key=文档链接全串,不拿 key 断言)
    expect(row.verify_state).toBe('insufficient')
    expect(row.verify_reason).toBe('自家新模型但信源未给规格')
    expect((await svc.archive()).pendingClues.some((c) => c.title.includes('GLM-9.9'))).toBe(true) // 触人
    const first = calls
    await svc.pollProvider('zhipu')
    expect(calls).toBe(first) // 不重试
  })
})
