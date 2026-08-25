import { describe, expect, it } from 'vitest'
import type { TrackedModel } from 'chrome-tab-shared'
import {
  AVAILABILITY_LABELS,
  benchmarkLabel,
  compareModelsByLatestEvent,
  formatEvaluationScore,
  EVENT_KIND_LABELS,
  MODEL_KIND_LABELS,
  PROVIDER_LABELS,
  STAGE_LABELS,
  formatModelPricing,
  isFreshModelEvent,
  modelEventAnchorMs,
} from './modelTracking'

/** 前端渲染最小检查(issues/01:展示语汇 + 24h 红点;issues/02:详情缺省值)。 */

describe('模型追踪:展示语汇', () => {
  it('八类模型种类标签齐备(与 CONTEXT.md 枚举一字不差)', () => {
    expect(MODEL_KIND_LABELS.text).toBe('文本')
    expect(MODEL_KIND_LABELS.multimodal_understanding).toBe('多模态理解')
    expect(MODEL_KIND_LABELS.image_generation).toBe('图像生成')
    expect(MODEL_KIND_LABELS.video_generation).toBe('视频生成')
    expect(MODEL_KIND_LABELS.audio_speech).toBe('音频/语音')
    expect(MODEL_KIND_LABELS.embedding).toBe('向量')
    expect(MODEL_KIND_LABELS.rerank).toBe('重排')
    expect(MODEL_KIND_LABELS.moderation_classification).toBe('审核/分类')
  })

  it('阶段/开放方式/动态类型/厂家标签齐备', () => {
    expect(STAGE_LABELS.ga).toBe('GA')
    expect(STAGE_LABELS.retired).toBe('已退役')
    expect(AVAILABILITY_LABELS.open_weights).toBe('开放权重')
    expect(EVENT_KIND_LABELS.updated).toBe('更新')
    expect(EVENT_KIND_LABELS.alias_repointed).toBe('别名换指向') // issues/05 xAI 别名换指向动态
    expect(PROVIDER_LABELS.zhipu).toBe('智谱')
    expect(PROVIDER_LABELS.openai).toBe('OpenAI') // issues/03
    expect(PROVIDER_LABELS.anthropic).toBe('Anthropic')
    expect(PROVIDER_LABELS.xai).toBe('xAI')
    expect(PROVIDER_LABELS.moonshot).toBe('月之暗面') // issues/06
    expect(PROVIDER_LABELS.deepseek).toBe('DeepSeek') // issues/07
  })

  it('厂家 tab 覆盖:PROVIDER_LABELS 键集即「全部」之外的 tab 集(issues/03-07 六厂家)', () => {
    // ModelModal 的 TABS 自 PROVIDER_LABELS 派生:键集扩即 tab 随动(「全部」+ 各跟踪厂家)
    expect(Object.keys(PROVIDER_LABELS).sort()).toEqual(['anthropic', 'deepseek', 'moonshot', 'openai', 'xai', 'zhipu'])
  })
})

describe('模型追踪:24h 红点窗口', () => {
  it('锚点 = 北京时间当日零点(日期粒度的最诚实表达,对齐 AI 日报先例)', () => {
    expect(modelEventAnchorMs('2026-08-19')).toBe(Date.parse('2026-08-19T00:00:00+08:00'))
  })

  it('非法日期回 null', () => {
    expect(modelEventAnchorMs('2026-8-19')).toBeNull()
    expect(modelEventAnchorMs('')).toBeNull()
    expect(modelEventAnchorMs('2026-08-19T10:00:00Z')).toBeNull()
  })

  it('当日动态带红点、昨日之前不带(时间驱动满窗自隐,无已读概念)', () => {
    const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10) // 北京时间今天
    const yesterday = new Date(Date.now() + 8 * 3600 * 1000 - 24 * 3600 * 1000).toISOString().slice(0, 10)
    expect(isFreshModelEvent(today)).toBe(true)
    expect(isFreshModelEvent(yesterday)).toBe(false)
  })

  it('锚点 24h 后窗口关闭', () => {
    const anchor = modelEventAnchorMs('2026-08-19')!
    expect(isFreshModelEvent('2026-08-19', anchor + 23 * 3600 * 1000)).toBe(true)
    expect(isFreshModelEvent('2026-08-19', anchor + 25 * 3600 * 1000)).toBe(false)
  })
})

/** 排序测试的最小模型工厂(events[0] 为最新动态,archive() 保证倒序)。 */
const mkModel = (id: number, over: Partial<TrackedModel> = {}): TrackedModel => ({
  id,
  provider: 'zhipu',
  officialId: `m${id}`,
  name: `M${id}`,
  kind: 'text',
  stage: 'ga',
  availability: ['api'],
  summary: null,
  sources: [],
  pricing: null,
  limits: null,
  trainingParams: null,
  evaluations: [],
  events: [],
  ...over,
})

describe('模型追踪:列表排序(全部 tab 与块内列表共用)', () => {
  it('最新动态优先——id 序垫底但昨天有动态的模型,排在 id 序靠前但无动态的智谱模型之前', () => {
    // 线上症状:智谱 44 个按入库 id 连排最前,其余厂家被压数屏之后(2026-08-25)
    const zhipuOld = mkModel(1) // 无动态,id 最小
    const openaiFresh = mkModel(100, {
      provider: 'openai',
      events: [{ id: 1, kind: 'updated', occurredOn: '2026-08-24', title: 't', sourceUrl: 'u' }],
    })
    expect([zhipuOld, openaiFresh].sort(compareModelsByLatestEvent)[0]).toBe(openaiFresh)
  })

  it('动态日期降序;同日按 id 升序稳定', () => {
    const a = mkModel(10, { events: [{ id: 1, kind: 'updated', occurredOn: '2026-08-01', title: 't', sourceUrl: 'u' }] })
    const b = mkModel(2, { events: [{ id: 1, kind: 'updated', occurredOn: '2026-08-25', title: 't', sourceUrl: 'u' }] })
    const c = mkModel(3, { events: [{ id: 1, kind: 'updated', occurredOn: '2026-08-25', title: 't', sourceUrl: 'u' }] })
    expect([a, b, c].sort(compareModelsByLatestEvent).map((m) => m.id)).toEqual([2, 3, 10])
  })

  it('退役模型沉底(CONTEXT.md「可用在前、已退役在后」),退役内部仍按动态降序', () => {
    const retiredFresh = mkModel(5, {
      stage: 'retired',
      events: [{ id: 1, kind: 'retired', occurredOn: '2026-08-25', title: 't', sourceUrl: 'u' }],
    })
    const retiredStale = mkModel(6, {
      stage: 'retired',
      events: [{ id: 1, kind: 'retired', occurredOn: '2025-01-01', title: 't', sourceUrl: 'u' }],
    })
    const active = mkModel(1)
    expect([retiredStale, retiredFresh, active].sort(compareModelsByLatestEvent).map((m) => m.id)).toEqual([
      1,
      5,
      6,
    ])
  })
})

describe('模型追踪:详情缺省值(issues/02)', () => {
  it('价格展示:地区作用域 + 逐条原文(作用域括注);null → null(显示「官方未披露」)', () => {
    expect(
      formatModelPricing({
        region: '中国大陆开放平台(bigmodel.cn)',
        effectiveFrom: null,
        entries: [
          { text: '输入 8 元/百万 tokens', scope: null },
          { text: '输入 6 元/百万 tokens', scope: '输入长度 [0, 32)' },
        ],
      }),
    ).toEqual({
      region: '中国大陆开放平台(bigmodel.cn)',
      lines: ['输入 8 元/百万 tokens', '输入 6 元/百万 tokens(输入长度 [0, 32))'],
    })
    expect(formatModelPricing(null)).toBeNull()
    expect(formatModelPricing({ region: 'x', effectiveFrom: null, entries: [] })).toBeNull()
  })
})

describe('评测展示语汇(issues/08)', () => {
  it('分数三态:Elo 整数、名单内准确率转百分比、指数类原值(0–1 正值指数不误转百分比)', () => {
    expect(formatEvaluationScore('text_to_image_elo', 1250)).toBe('1250')
    expect(formatEvaluationScore('mmlu_pro', 0.791)).toBe('79.1%')
    expect(formatEvaluationScore('artificial_analysis_intelligence_index', 62.9)).toBe('62.9')
    expect(formatEvaluationScore('aa_omniscience_index', -12.34)).toBe('-12.3')
    // 按基准 key 判定,不按数值区间:指数 0.5 不是 50%
    expect(formatEvaluationScore('aa_omniscience_index', 0.5)).toBe('0.5')
    // 名单外的新比例型基准:原样显示,不猜
    expect(formatEvaluationScore('some_new_ratio_bench', 0.42)).toBe('0.4')
  })

  it('Benchmark 标签:已知 key 用展示名,未知 key 兜底可读化(评测方命名演进不漏显示)', () => {
    expect(benchmarkLabel('mmlu_pro')).toBe('MMLU-Pro')
    expect(benchmarkLabel('text_to_video_elo')).toBe('文生视频 Elo')
    expect(benchmarkLabel('tau_banking')).toBe('τ³-Banking')
    // 兜底为 best-effort:短词按缩写全大写(如 lcr→LCR),'new' 亦然——可接受
    expect(benchmarkLabel('some_new_bench')).toBe('Some NEW Bench')
  })

  it('evaluated 动态有展示名(Record 键完整性由 tsc 保障)', () => {
    expect(EVENT_KIND_LABELS.evaluated).toBe('进入评测')
  })
})
