import { describe, expect, it } from 'vitest'
import type { TrackedModel } from 'chrome-tab-shared'
import {
  AVAILABILITY_LABELS,
  benchmarkLabel,
  compareModelsByRelease,
  formatEvaluationScore,
  EVENT_KIND_LABELS,
  MODEL_KIND_COLOR_CLASSES,
  MODEL_KIND_LABELS,
  PROVIDER_LABELS,
  STAGE_LABELS,
  formatModelPricing,
  formatLatestEventBrief,
  formatReleaseBrief,
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

  it('种类着色分类全覆盖:文本世界不占色,媒体三类各一色,基础设施三类共色', () => {
    const allKinds = Object.keys(MODEL_KIND_LABELS) as Array<keyof typeof MODEL_KIND_LABELS>
    // 全覆盖(ModelKind 票扩漏配即红)
    expect(Object.keys(MODEL_KIND_COLOR_CLASSES).sort()).toEqual([...allKinds].sort())
    expect(MODEL_KIND_COLOR_CLASSES.text).toBe('') // 文本世界沿用默认灰
    expect(MODEL_KIND_COLOR_CLASSES.multimodal_understanding).toBe('')
    // 媒体生成三类暖色各一色(彼此时区分)
    expect(MODEL_KIND_COLOR_CLASSES.image_generation).toBe('text-pink-300')
    expect(MODEL_KIND_COLOR_CLASSES.video_generation).toBe('text-orange-300')
    expect(MODEL_KIND_COLOR_CLASSES.audio_speech).toBe('text-lime-300')
    // 检索/安全基础设施共冷色一档
    expect(MODEL_KIND_COLOR_CLASSES.embedding).toBe('text-indigo-300')
    expect(MODEL_KIND_COLOR_CLASSES.rerank).toBe(MODEL_KIND_COLOR_CLASSES.embedding)
    expect(MODEL_KIND_COLOR_CLASSES.moderation_classification).toBe(
      MODEL_KIND_COLOR_CLASSES.embedding,
    )
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

  it('厂家 tab 覆盖:PROVIDER_LABELS 键集即「全部」之外的 tab 集(issues/03-09 七厂家)', () => {
    // ModelModal 的 TABS 自 PROVIDER_LABELS 派生:键集扩即 tab 随动(「全部」+ 各跟踪厂家)
    expect(Object.keys(PROVIDER_LABELS).sort()).toEqual(['alibaba', 'anthropic', 'deepseek', 'moonshot', 'openai', 'xai', 'zhipu'])
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
  it('发布时间降序——gpt-5.6-sol 场景:发布 07-09、最新动态 08-21 降价,排位按 07-09 不因更新被顶前', () => {
    // 2026-08-26 需求:排序轴 = 上线发布时间(可用类事件最早者),非最新动态——
    // 按动态排使老模型因降价动态压过新发布模型,读作「刚发布」
    const sol = mkModel(89, {
      provider: 'openai',
      events: [
        { id: 1, kind: 'updated', occurredOn: '2026-08-21', title: '降价', sourceUrl: 'u' },
        { id: 2, kind: 'api_available', occurredOn: '2026-07-09', title: '上线 API', sourceUrl: 'u' },
      ],
    })
    const newerRelease = mkModel(120, {
      provider: 'zhipu',
      events: [{ id: 1, kind: 'api_available', occurredOn: '2026-08-10', title: '上线', sourceUrl: 'u' }],
    })
    expect([sol, newerRelease].sort(compareModelsByRelease)[0]).toBe(newerRelease)
  })

  it('发布锚点 = 可用类事件(api/产品/权重)最早者;多条可用取最早,更新动态不参与', () => {
    const m = mkModel(1, {
      events: [
        { id: 1, kind: 'updated', occurredOn: '2026-08-25', title: 't', sourceUrl: 'u' },
        { id: 2, kind: 'first_party_available', occurredOn: '2026-06-01', title: 't', sourceUrl: 'u' },
        { id: 3, kind: 'api_available', occurredOn: '2026-05-01', title: 't', sourceUrl: 'u' },
      ],
    })
    const laterAvail = mkModel(2, {
      events: [{ id: 1, kind: 'api_available', occurredOn: '2026-05-02', title: 't', sourceUrl: 'u' }],
    })
    expect([m, laterAvail].sort(compareModelsByRelease).map((x) => x.id)).toEqual([2, 1]) // 05-01 早于 05-02,降序在后
  })

  it('无可用类事件的模型回退最早动态为锚点(gpt-5.6-cyber 仅 updated 行);无事件沉底', () => {
    const cyber = mkModel(92, {
      events: [{ id: 1, kind: 'updated', occurredOn: '2026-08-07', title: 't', sourceUrl: 'u' }],
    })
    const noEvents = mkModel(1) // 智谱无动态模型不因 id 靠前垄断首屏(2026-08-25 症状延续防护)
    const released = mkModel(3, {
      events: [{ id: 1, kind: 'api_available', occurredOn: '2026-08-20', title: 't', sourceUrl: 'u' }],
    })
    expect([noEvents, cyber, released].sort(compareModelsByRelease).map((x) => x.id)).toEqual([3, 92, 1])
  })

  it('发布日期同日按 id 升序稳定', () => {
    const a = mkModel(10, { events: [{ id: 1, kind: 'api_available', occurredOn: '2026-08-01', title: 't', sourceUrl: 'u' }] })
    const b = mkModel(2, { events: [{ id: 1, kind: 'api_available', occurredOn: '2026-08-01', title: 't', sourceUrl: 'u' }] })
    const c = mkModel(3, { events: [{ id: 1, kind: 'api_available', occurredOn: '2026-08-01', title: 't', sourceUrl: 'u' }] })
    expect([a, b, c].sort(compareModelsByRelease).map((m) => m.id)).toEqual([2, 3, 10])
  })

  it('退役模型沉底(CONTEXT.md「可用在前、已退役在后」),退役内部仍按发布降序', () => {
    const retiredFresh = mkModel(5, {
      stage: 'retired',
      events: [{ id: 1, kind: 'retired', occurredOn: '2026-08-25', title: 't', sourceUrl: 'u' }],
    })
    const retiredStale = mkModel(6, {
      stage: 'retired',
      events: [{ id: 1, kind: 'retired', occurredOn: '2025-01-01', title: 't', sourceUrl: 'u' }],
    })
    const active = mkModel(1)
    expect([retiredStale, retiredFresh, active].sort(compareModelsByRelease).map((m) => m.id)).toEqual([
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

describe('模型追踪:发布简报(详情行尾,2026-08-26 行尾改发布轴)', () => {
  it('可用类锚点标「发布」取最早;回退锚点标「见于」不谎称发布;无动态 null', () => {
    // GPT-5.6 Sol 场景:最新动态 08-21 降价,行尾仍显发布 07-09(排序轴同源)
    const sol = mkModel(89, {
      events: [
        { id: 1, kind: 'updated', occurredOn: '2026-08-21', title: '降价', sourceUrl: 'u' },
        { id: 2, kind: 'api_available', occurredOn: '2026-07-09', title: '上线 API', sourceUrl: 'u' },
      ],
    })
    expect(formatReleaseBrief(sol)).toBe('发布 · 2026-07-09')
    const cyber = mkModel(92, {
      events: [{ id: 1, kind: 'updated', occurredOn: '2026-08-07', title: 't', sourceUrl: 'u' }],
    })
    expect(formatReleaseBrief(cyber)).toBe('见于 · 2026-08-07')
    expect(formatReleaseBrief(mkModel(1))).toBeNull()
  })
})

describe('模型追踪:最近动态简报', () => {
  // now 固定 2026-08-26 中午(北京时间):08-21 锚点零点起 5 天 12 小时 → 「5 天前」
  const NOW = Date.parse('2026-08-26T12:00:00+08:00')

  it('动态简报带类型锚定——降价更新不被读作发布时间(2026-08-26 线上症状)', () => {
    // GPT-5.6 Sol 真实发布 2026-07-09,最新动态是 08-21 降价:
    // 小块行此前裸显「5 天前」被读成「5 天前发布」,补「更新」锚定后歧义消除
    expect(formatLatestEventBrief({ kind: 'updated', occurredOn: '2026-08-21' }, NOW)).toBe('更新 · 5 天前')
  })

  it('发布类动态如实标注;非法日期回原串不吞信息(对齐 Modal 原 || occurredOn 兜底)', () => {
    expect(formatLatestEventBrief({ kind: 'api_available', occurredOn: '2026-07-09' }, NOW)).toBe('API 上线 · 48 天前')
    expect(formatLatestEventBrief({ kind: 'updated', occurredOn: 'oops' }, NOW)).toBe('oops')
  })
})
