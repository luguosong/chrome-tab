import { describe, expect, it } from 'vitest'
import type { ModelEvent, TrackedModel } from 'chrome-tab-shared'
import { openDb, type Db } from './db'
import {
  ANTHROPIC_BASELINE,
  DEEPSEEK_BASELINE,
  KIMI_BASELINE,
  ModelTrackingService,
  OPENAI_BASELINE,
  type ModelTrackingDeps,
  XAI_BASELINE,
  ZHIPU_BASELINE,
} from './modelTracking'
import { AA_LLM_URL, AA_MEDIA_ENDPOINTS, AA_MODEL_MAP, aaModelUrl, aaRowsFromLlms, aaRowsFromMedia, beijingToday } from './aaEvaluations'

/**
 * 评测接入自动检查(issues/08,CONTEXT.md「评测结果」):解析透传、slug 精确映射
 * (变体/快照不认领)、快照替换、首入评测动态、漂移不产动态、未配置 no-op、失败保留
 * 快照且只标评测陈旧(与厂家信源分表互不影响)。IO 全经假 fetchText,零真网。
 */

/** LLM 主表快照节选(2026-08-25 API 口径:evaluations 逐 Benchmark 数值;混映射外条目)。 */
const AA_LLM_JSON = JSON.stringify({
  status: 200,
  data: [
    {
      id: '2dad8957-4c16-4e74-bf2d-8b21514e0ae9',
      name: 'GLM-4.7',
      slug: 'glm-4-7',
      model_creator: { id: 'c1', name: 'Zhipu', slug: 'zhipu' },
      evaluations: { artificial_analysis_intelligence_index: 62.9, mmlu_pro: 0.791, gpqa: null },
      pricing: { price_1m_input_tokens: 1.1 },
    },
    {
      id: 'u2',
      name: 'GPT-5.5 (high)',
      slug: 'gpt-5-5-high', // effort 变体:不映射
      model_creator: { id: 'c2', name: 'OpenAI', slug: 'openai' },
      evaluations: { mmlu_pro: 0.9 },
    },
    {
      id: 'u3',
      name: 'Some Third Party',
      slug: 'qwen3-max', // 非跟踪厂家:不映射
      model_creator: { id: 'c3', name: 'Alibaba', slug: 'alibaba' },
      evaluations: { mmlu_pro: 0.8 },
    },
  ],
})

/** 媒体榜单快照节选(在榜一方模型 + elo;rank/categories 不入库)。 */
const AA_T2I_JSON = JSON.stringify({
  status: 200,
  data: [
    { id: 'gpt-image-2', name: 'GPT Image 2', slug: 'gpt-image-2', model_creator: { id: 'openai', name: 'OpenAI' }, elo: 1250, rank: 1, ci95: '-5/+5' },
    { id: 'x1', name: 'FLUX Krea', slug: 'flux-krea', model_creator: { id: 'bfl', name: 'Black Forest Labs' }, elo: 1180, rank: 2 },
  ],
})

const EMPTY_MEDIA_JSON = JSON.stringify({ status: 200, data: [] })

/** 六路端点全就位的 deps(其余 URL 一律 404,厂家源状态与本文件断言无关)。 */
function aaDeps(pages: Record<string, string>): ModelTrackingDeps {
  return {
    fetchText: async (url) => {
      const page = pages[url]
      if (page === undefined) throw new Error('HTTP 404')
      return page
    },
  }
}

function fullPages(): Record<string, string> {
  return {
    [AA_LLM_URL]: AA_LLM_JSON,
    ...Object.fromEntries(AA_MEDIA_ENDPOINTS.map((ep) => [ep.url, EMPTY_MEDIA_JSON])),
    // 文生图单独给数据,其余媒体榜空(合法态)
    [AA_MEDIA_ENDPOINTS[0].url]: AA_T2I_JSON,
  }
}

async function makeService(db: Db, deps: ModelTrackingDeps, aaApiKey = 'test-key') {
  const svc = new ModelTrackingService(db, deps, aaApiKey)
  await svc.init()
  return svc
}

const evalsOf = (m: { evaluations: TrackedModel['evaluations'] }, benchmark: string) =>
  m.evaluations.find((e) => e.benchmark === benchmark)

describe('评测:解析与映射(纯函数)', () => {
  it('LLM 端点:映射内 slug 逐 Benchmark 透传,携带版本名与模型页链接;null 分跳过', () => {
    const rows = aaRowsFromLlms(AA_LLM_JSON)
    expect(rows).toHaveLength(2) // glm-4-7 的两个数值项
    expect(rows[0]).toEqual({
      provider: 'zhipu',
      officialId: 'glm-4.7',
      benchmark: 'artificial_analysis_intelligence_index',
      score: 62.9,
      version: 'GLM-4.7',
      url: aaModelUrl('glm-4-7'),
    })
    expect(rows.some((r) => r.benchmark === 'gpqa')).toBe(false) // null 不透传
    expect(rows.every((r) => r.officialId === 'glm-4.7')).toBe(true) // 变体/第三方不认领
  })

  it('LLM 端点:零模型与缺 data 数组 = 上游改版,抛错(调用方标陈旧)', () => {
    expect(() => aaRowsFromLlms(JSON.stringify({ status: 200, data: [] }))).toThrow()
    expect(() => aaRowsFromLlms('<html>login</html>')).toThrow()
  })

  it('媒体端点:Elo 即分数、benchmark 用端点 key;空榜为合法零行;无 Elo 条目跳过', () => {
    const rows = aaRowsFromMedia(AA_T2I_JSON, 'text_to_image_elo')
    expect(rows).toEqual([
      {
        provider: 'openai',
        officialId: 'gpt-image-2',
        benchmark: 'text_to_image_elo',
        score: 1250,
        version: 'GPT Image 2',
        url: aaModelUrl('gpt-image-2'),
      },
    ])
    expect(aaRowsFromMedia(EMPTY_MEDIA_JSON, 'text_to_image_elo')).toEqual([])
  })

  it('快照日期取北京时间(UTC 20:00 已是次日)', () => {
    expect(beijingToday(new Date('2026-08-24T20:00:00Z'))).toBe('2026-08-25')
    expect(beijingToday(new Date('2026-08-24T10:00:00Z'))).toBe('2026-08-24')
  })

  it('映射表形状:值唯一(防同模型双 slug 撞评测唯一键),且每项命中对应厂家基线行', () => {
    const targets = Object.values(AA_MODEL_MAP).map((m) => `${m.provider}|${m.officialId}`)
    expect(new Set(targets).size).toBe(targets.length)
    const baselines = {
      zhipu: ZHIPU_BASELINE,
      openai: OPENAI_BASELINE,
      anthropic: ANTHROPIC_BASELINE,
      xai: XAI_BASELINE,
      moonshot: KIMI_BASELINE,
      deepseek: DEEPSEEK_BASELINE,
    }
    for (const [slug, m] of Object.entries(AA_MODEL_MAP)) {
      const hit = baselines[m.provider].some((b) => b.officialId === m.officialId)
      expect(hit, `${slug} → ${m.provider}/${m.officialId} 不在基线`).toBe(true)
    }
  })
})

describe('评测:轮询与快照(服务集成,零真网)', () => {
  it('配置 Key:评测行入档、信封 configured=true、首入产 evaluated 动态', async () => {
    const { db } = openDb(':memory:')
    const svc = await makeService(db, aaDeps(fullPages()))
    await svc.pollEvaluations()
    const a = await svc.archive()
    expect(a.evaluations).toMatchObject({ configured: true, stale: false })
    expect(a.evaluations.lastSuccessAt).not.toBeNull()
    const glm47 = a.models.find((m) => m.officialId === 'glm-4.7')!
    expect(evalsOf(glm47, 'mmlu_pro')!.score).toBe(0.791)
    expect(evalsOf(glm47, 'mmlu_pro')!.version).toBe('GLM-4.7')
    expect(evalsOf(glm47, 'mmlu_pro')!.url).toBe(aaModelUrl('glm-4-7'))
    expect(evalsOf(glm47, 'mmlu_pro')!.evaluator).toBe('Artificial Analysis')
    expect(evalsOf(a.models.find((m) => m.officialId === 'gpt-image-2')!, 'text_to_image_elo')!.score).toBe(1250)
    // 首入评测动态(可回链模型页)
    const kinds = (m: { events: ModelEvent[] }) => m.events.filter((e) => e.kind === 'evaluated')
    expect(kinds(glm47).map((e) => e.title)).toEqual(['进入 Artificial Analysis 评测'])
    expect(kinds(glm47)[0]!.sourceUrl).toBe(aaModelUrl('glm-4-7'))
  })

  it('分数漂移:快照行更新,不产生新动态;快照日期随轮刷新', async () => {
    const { sqlite, db } = openDb(':memory:')
    const svc = await makeService(db, aaDeps(fullPages()))
    await svc.pollEvaluations()
    const pages2 = fullPages()
    pages2[AA_LLM_URL] = AA_LLM_JSON.replace('0.791', '0.801')
    const svc2 = new ModelTrackingService(db, aaDeps(pages2), 'test-key') // 免 init:不触发厂家轮询
    await svc2.pollEvaluations()
    const a = await svc.archive()
    const glm47 = a.models.find((m) => m.officialId === 'glm-4.7')!
    expect(evalsOf(glm47, 'mmlu_pro')!.score).toBe(0.801)
    expect(glm47.events.filter((e) => e.kind === 'evaluated')).toHaveLength(1)
    expect(sqlite.prepare('SELECT COUNT(*) c FROM model_evaluations').get()).toMatchObject({ c: 3 })
  })

  it('评测源失败:保留最后成功快照、只标评测陈旧,厂家信源状态表不被触碰', async () => {
    const { sqlite, db } = openDb(':memory:')
    const svc = await makeService(db, aaDeps(fullPages()))
    await svc.pollEvaluations()
    const before = JSON.stringify(sqlite.prepare('SELECT * FROM model_fetch_status').all())
    const svc2 = new ModelTrackingService(db, aaDeps({}), 'test-key')
    await expect(svc2.pollEvaluations()).rejects.toThrow()
    const a = await svc.archive()
    expect(a.evaluations).toMatchObject({ configured: true, stale: true })
    expect(evalsOf(a.models.find((m) => m.officialId === 'glm-4.7')!, 'mmlu_pro')!.score).toBe(0.791)
    expect(JSON.stringify(sqlite.prepare('SELECT * FROM model_fetch_status').all())).toBe(before)
  })

  it('未配置 Key:轮询 no-op——无评测行、无状态行,信封明确「未配置」', async () => {
    const { sqlite, db } = openDb(':memory:')
    const svc = await makeService(db, aaDeps({}), '')
    await svc.pollEvaluations()
    const a = await svc.archive()
    expect(a.evaluations).toEqual({ configured: false, stale: false, lastSuccessAt: null })
    expect(sqlite.prepare('SELECT COUNT(*) c FROM model_evaluations').get()).toMatchObject({ c: 0 })
    expect(sqlite.prepare('SELECT COUNT(*) c FROM model_evaluation_status').get()).toMatchObject({ c: 0 })
    expect(a.models.every((m) => m.evaluations.length === 0)).toBe(true)
  })

  it('映射指向的模型页 URL 均以映射 slug 收尾(可回链核验)', async () => {
    const { db } = openDb(':memory:')
    const svc = await makeService(db, aaDeps(fullPages()))
    await svc.pollEvaluations()
    const a = await svc.archive()
    for (const m of a.models) {
      for (const e of m.evaluations) {
        expect(e.url.startsWith('https://artificialanalysis.ai/models/')).toBe(true)
        expect(Object.keys(AA_MODEL_MAP)).toContain(e.url.split('/').pop()!)
      }
    }
  })
})
