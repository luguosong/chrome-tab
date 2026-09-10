import { describe, expect, it } from 'vitest'
import { openDb } from './db'
import { ModelTrackingService } from './modelTracking'
import { OPENAI_DEF } from './providers/openai'
import { ANTHROPIC_DEF } from './providers/anthropic'
import { ALIBABA_DEF } from './providers/alibaba'
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

  it('reject(LLM 判噪音):线索 rejected 留表触人(读侧可见),无档案行', async () => {
    const llm = JSON.stringify({ isNoise: true, reason: '平台功能条目', draft: null })
    const { db } = openDb(':memory:')
    const svc = new ModelTrackingService(db, makeDeps(llm), '')
    await svc.init()
    await svc.pollProvider('zhipu')
    const a = await svc.archive()
    expect(a.models.some((m) => m.officialId === 'glm-9.9')).toBe(false)
    expect(a.pendingClues.some((c) => c.title.includes('GLM-9.9'))).toBe(true) // 待人工
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
})
