import { describe, expect, it } from 'vitest'
import type { ModelEvent, TrackedModel } from 'chrome-tab-shared'
import { openDb, type Db } from './db'
import { ModelTrackingService, type BaselineModel, type ModelTrackingDeps } from './modelTracking'
import { STUB_UPSTREAM_KEY } from './testUtils'
import seedJson from './modelBaselineSeed.json'
import {
  AA_LLM_URL,
  AA_MEDIA_ENDPOINTS,
  aaAutoMappings,
  aaMappingIndex,
  aaModelUrl,
  aaRowsFromLlms,
  aaRowsFromMedia,
  beijingToday,
  type AaMappingRow,
} from './aaEvaluations'

/**
 * 评测接入自动检查(issues/08,CONTEXT.md「评测结果」):解析透传、slug 精确映射
 * (变体/快照不认领)、同名自动映射(ADR-0058)、快照替换、首入评测动态、漂移不产
 * 动态、未配置 no-op、失败保留快照且只标评测陈旧(与厂家信源分表互不影响)。
 * IO 全经假 fetchText,零真网。基线/映射自种子快照派生(ADR-0058 基线 DB 化)。
 */

const SEED = seedJson as { models: BaselineModel[]; aaMapping: AaMappingRow[] }
const SEED_MODELS = SEED.models
const seeded = (provider: string): BaselineModel[] => SEED_MODELS.filter((b) => b.provider === provider)
const ZHIPU_BASELINE = seeded('zhipu')
const ANTHROPIC_BASELINE = seeded('anthropic')
const XAI_BASELINE = seeded('xai')
const KIMI_BASELINE = seeded('moonshot')
const OPENAI_BASELINE = seeded('openai')
const DEEPSEEK_BASELINE = seeded('deepseek')
const QWEN_BASELINE = seeded('alibaba')
const ALL_SEED_BASELINES = [...ZHIPU_BASELINE, ...ANTHROPIC_BASELINE, ...XAI_BASELINE, ...KIMI_BASELINE, ...OPENAI_BASELINE, ...DEEPSEEK_BASELINE, ...QWEN_BASELINE]
const SEED_MAPPING = aaMappingIndex(SEED.aaMapping)

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
      slug: 'minimax-m2', // 非跟踪厂家:不映射
      model_creator: { id: 'c3', name: 'MiniMax', slug: 'minimax' },
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

/** 六路端点全就位的 deps(其余 URL 一律 404,厂家源状态与本文件断言无关;auto 核验 env 关闭)。 */
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

async function makeService(db: Db, deps: ModelTrackingDeps, aaApiKey = STUB_UPSTREAM_KEY) {
  const svc = new ModelTrackingService(db, deps, aaApiKey)
  await svc.init()
  return svc
}

const evalsOf = (m: { evaluations: TrackedModel['evaluations'] }, benchmark: string) =>
  m.evaluations.find((e) => e.benchmark === benchmark)

describe('评测:解析与映射(纯函数)', () => {
  it('LLM 端点:映射内 slug 逐 Benchmark 透传,携带版本名与模型页链接;null 分跳过', () => {
    const rows = aaRowsFromLlms(AA_LLM_JSON, SEED_MAPPING)
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
    expect(() => aaRowsFromLlms(JSON.stringify({ status: 200, data: [] }), SEED_MAPPING)).toThrow()
    expect(() => aaRowsFromLlms('<html>login</html>', SEED_MAPPING)).toThrow()
  })

  it('媒体端点:Elo 即分数、benchmark 用端点 key;空榜为合法零行;无 Elo 条目跳过', () => {
    const rows = aaRowsFromMedia(AA_T2I_JSON, 'text_to_image_elo', SEED_MAPPING)
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
    expect(aaRowsFromMedia(EMPTY_MEDIA_JSON, 'text_to_image_elo', SEED_MAPPING)).toEqual([])
  })

  it('快照日期取北京时间(UTC 20:00 已是次日)', () => {
    expect(beijingToday(new Date('2026-08-24T20:00:00Z'))).toBe('2026-08-25')
    expect(beijingToday(new Date('2026-08-24T10:00:00Z'))).toBe('2026-08-24')
  })

  it('同名自动映射(ADR-0058):creator 归跟踪厂家 × 基线同名(圆点归一) × 未映射三条件齐才产映射行', () => {
    const json = JSON.stringify({
      status: 200,
      data: [
        { slug: 'glm-5-turbo', name: 'GLM-5-Turbo', model_creator: { slug: 'zai' }, evaluations: {} },
        { slug: 'gpt-6-2', name: 'GPT-6.2', model_creator: { slug: 'openai' }, evaluations: {} },
        { slug: 'gemini-3', name: 'Gemini 3', model_creator: { slug: 'google' }, evaluations: {} },
        { slug: 'glm-4-7', name: 'GLM-4.7', model_creator: { slug: 'zai' }, evaluations: {} },
        { slug: 'glm-9-9', name: 'GLM-9.9', model_creator: { slug: 'zai' }, evaluations: {} },
        { slug: 'gpt-6-2-xhigh', name: 'GPT-6.2 (xhigh)', model_creator: { slug: 'openai' }, evaluations: {} },
        { slug: 'nope', name: '无 creator 条目', evaluations: {} },
        { slug: 'claude-x', name: 'Claude X', model_creator: { slug: 'zai' }, evaluations: {} },
      ],
    })
    const baselines = [
      { provider: 'zhipu' as const, officialId: 'glm-5.7', matchAliases: ['glm-5-turbo'] },
      { provider: 'openai' as const, officialId: 'gpt-6.2', matchAliases: ['gpt-6.2'] },
      // 同名基线行是 anthropic 的,但条目 creator 判 zhipu → 交叉校验不过,不映射
      { provider: 'anthropic' as const, officialId: 'claude-x', matchAliases: [] },
      // 该行的 slug 'glm-4-7' 未在映射,但目标已被别名 slug 'glm-4-7-alt' 占用 → 唯一目标守卫拦
      { provider: 'zhipu' as const, officialId: 'glm-4.7', matchAliases: ['glm-4.7'] },
    ]
    const autos = aaAutoMappings(json, baselines, new Map([['glm-4-7-alt', 'zhipu|glm-4.7']]))
    expect(autos).toEqual([
      { slug: 'glm-5-turbo', provider: 'zhipu', officialId: 'glm-5.7' },
      { slug: 'gpt-6-2', provider: 'openai', officialId: 'gpt-6.2' },
    ])
  })

  it('映射形态:种子映射值唯一(防同模型双 slug 撞评测唯一键),且每项命中对应厂家基线行', () => {
    const targets = SEED.aaMapping.map((m) => `${m.provider}|${m.officialId}`)
    expect(new Set(targets).size).toBe(targets.length)
    const baselines = {
      zhipu: ZHIPU_BASELINE,
      openai: OPENAI_BASELINE,
      anthropic: ANTHROPIC_BASELINE,
      xai: XAI_BASELINE,
      moonshot: KIMI_BASELINE,
      deepseek: DEEPSEEK_BASELINE,
      alibaba: QWEN_BASELINE,
    }
    for (const m of SEED.aaMapping) {
      const hit = baselines[m.provider as keyof typeof baselines].some((b) => b.officialId === m.officialId)
      expect(hit, `${m.slug} → ${m.provider}/${m.officialId} 不在基线`).toBe(true)
    }
  })

  it('基线归一键无跨行冲突(同名自动映射的 known 表是 last-wins Map,两行归一撞键会静默错归属;同行大小写变体无害)', () => {
    const norm = (s: string) => s.toLowerCase().replaceAll('.', '-')
    const seen = new Map<string, string>()
    for (const b of ALL_SEED_BASELINES) {
      for (const id of [b.officialId, ...b.matchAliases]) {
        const key = `${b.provider}|${norm(id)}`
        const prev = seen.get(key)
        expect(prev === undefined || prev === b.officialId, `归一键 ${key}(${b.officialId} 与 ${prev})跨行重复`).toBe(true)
        seen.set(key, b.officialId)
      }
    }
  })

  it('同名命中的线上存量盘点(2026-09-01 实测 25 条):全部命中真基线行、无一来自变体/别家误配', () => {
    // 守卫方向:同名口径的 known 集来自真基线——断言真基线能被 aaSlugNorm 归一命中
    // 线上 25 条中的代表 slug(防归一函数被改动后口径静默失效)
    const json = JSON.stringify({
      status: 200,
      data: [
        { slug: 'glm-5-turbo', name: 'GLM-5-Turbo', model_creator: { slug: 'zai' }, evaluations: {} },
        { slug: 'gpt-5-5-pro', name: 'GPT-5.5 Pro', model_creator: { slug: 'openai' }, evaluations: {} },
        { slug: 'deepseek-v3-2-speciale', name: 'DeepSeek V3.2 Speciale', model_creator: { slug: 'deepseek' }, evaluations: {} },
        { slug: 'grok-code-fast-1', name: 'Grok Code Fast 1', model_creator: { slug: 'xai' }, evaluations: {} },
      ],
    })
    expect(aaAutoMappings(json, ALL_SEED_BASELINES, new Map())).toHaveLength(4)
  })
})

describe('评测:轮询与快照(服务集成,零真网)', () => {
  it('配置 Key:评测行入档、信封 configured=true;首配接入不产 evaluated 动态(真实首入日不可考)', async () => {
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
    // 首配接入(Key 首次生效、快照表从空到满)是系统事件而非模型动态:不产 evaluated
    const kinds = (m: { events: ModelEvent[] }) => m.events.filter((e) => e.kind === 'evaluated')
    expect(kinds(glm47)).toHaveLength(0)
    expect(kinds(a.models.find((m) => m.officialId === 'gpt-image-2')!)).toHaveLength(0)
  })

  it('同名自动映射(ADR-0058):未映射同名条目随轮询直接进映射表(verified=auto),不再落 aa: 线索', async ({ }) => {
    const { sqlite, db } = openDb(':memory:')
    const pages = fullPages()
    pages[AA_LLM_URL] = JSON.stringify({
      status: 200,
      data: [
        ...JSON.parse(AA_LLM_JSON).data,
        { id: 'u9', name: 'GLM-5-Turbo', slug: 'glm-5-turbo', model_creator: { id: 'c1', name: 'Z AI', slug: 'zai' }, evaluations: { mmlu_pro: 0.6 } },
      ],
    })
    const svc = await makeService(db, aaDeps(pages))
    await svc.pollEvaluations()
    const mapping = sqlite.prepare("SELECT * FROM model_aa_mapping WHERE slug = 'glm-5-turbo'").get() as { provider: string; official_id: string; verified: string }
    expect(mapping).toMatchObject({ provider: 'zhipu', official_id: 'glm-5-turbo', verified: 'auto' })
    // 当轮映射即生效:评测行带上分数;线索表不落 aa: 键
    const a = await svc.archive()
    expect(evalsOf(a.models.find((m) => m.officialId === 'glm-5-turbo')!, 'mmlu_pro')!.score).toBe(0.6)
    expect(a.pendingClues.some((c) => c.provider === 'zhipu')).toBe(false)
  })

  it('运行期 AA 新收录:仅新模型产 evaluated 动态(occurred_on=发现日),老模型不产', async () => {
    const { db } = openDb(':memory:')
    const svc = await makeService(db, aaDeps(fullPages()))
    await svc.pollEvaluations() // 首配:静默
    const pages2 = fullPages()
    pages2[AA_LLM_URL] = JSON.stringify({
      status: 200,
      data: [
        ...JSON.parse(AA_LLM_JSON).data,
        { id: 'u4', name: 'GLM-4.6', slug: 'glm-4-6', model_creator: { id: 'c1', name: 'Zhipu', slug: 'zhipu' }, evaluations: { mmlu_pro: 0.75 } },
      ],
    })
    const svc2 = new ModelTrackingService(db, aaDeps(pages2), STUB_UPSTREAM_KEY) // 免 init:不触发厂家轮询
    await svc2.pollEvaluations()
    const a = await svc.archive()
    const kinds = (m: { events: ModelEvent[] }) => m.events.filter((e) => e.kind === 'evaluated')
    const glm46 = a.models.find((m) => m.officialId === 'glm-4.6')!
    expect(kinds(glm46).map((e) => e.title)).toEqual(['进入 Artificial Analysis 评测'])
    expect(kinds(glm46)[0]!.occurredOn).toBe(beijingToday())
    expect(kinds(glm46)[0]!.sourceUrl).toBe(aaModelUrl('glm-4-6'))
    expect(kinds(a.models.find((m) => m.officialId === 'glm-4.7')!)).toHaveLength(0)
  })

  it('分数漂移:快照行更新,不产生新动态;快照日期随轮刷新', async () => {
    const { sqlite, db } = openDb(':memory:')
    const svc = await makeService(db, aaDeps(fullPages()))
    await svc.pollEvaluations()
    const pages2 = fullPages()
    pages2[AA_LLM_URL] = AA_LLM_JSON.replace('0.791', '0.801')
    const svc2 = new ModelTrackingService(db, aaDeps(pages2), STUB_UPSTREAM_KEY) // 免 init:不触发厂家轮询
    await svc2.pollEvaluations()
    const a = await svc.archive()
    const glm47 = a.models.find((m) => m.officialId === 'glm-4.7')!
    expect(evalsOf(glm47, 'mmlu_pro')!.score).toBe(0.801)
    expect(glm47.events.filter((e) => e.kind === 'evaluated')).toHaveLength(0) // 首配静默 + 漂移不产动态
    expect(sqlite.prepare('SELECT COUNT(*) c FROM model_evaluations').get()).toMatchObject({ c: 3 })
  })

  it('评测源失败:保留最后成功快照、只标评测陈旧,厂家信源状态表不被触碰', async () => {
    const { sqlite, db } = openDb(':memory:')
    const svc = await makeService(db, aaDeps(fullPages()))
    await svc.pollEvaluations()
    const before = JSON.stringify(sqlite.prepare('SELECT * FROM model_fetch_status').all())
    const svc2 = new ModelTrackingService(db, aaDeps({}), STUB_UPSTREAM_KEY)
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
    const slugs = new Set(SEED.aaMapping.map((m) => m.slug))
    for (const m of a.models) {
      for (const e of m.evaluations) {
        expect(e.url.startsWith('https://artificialanalysis.ai/models/')).toBe(true)
        expect(slugs.has(e.url.split('/').pop()!)).toBe(true)
      }
    }
  })
})
