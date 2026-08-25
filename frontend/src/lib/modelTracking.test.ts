import { describe, expect, it } from 'vitest'
import {
  AVAILABILITY_LABELS,
  EVENT_KIND_LABELS,
  MODEL_KIND_LABELS,
  PROVIDER_LABELS,
  STAGE_LABELS,
  formatModelLimits,
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
    expect(PROVIDER_LABELS.anthropic).toBe('Anthropic')
    expect(PROVIDER_LABELS.xai).toBe('xAI')
  })

  it('厂家 tab 覆盖:PROVIDER_LABELS 键集即「全部」之外的 tab 集(issues/04 双厂家 + issues/05 xAI)', () => {
    // ModelModal 的 TABS 自 PROVIDER_LABELS 派生:键集扩即 tab 随动(「全部」+ 三厂家)
    expect(Object.keys(PROVIDER_LABELS).sort()).toEqual(['anthropic', 'xai', 'zhipu'])
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

describe('模型追踪:详情缺省值(issues/02)', () => {
  it('限额单行摘要:标签+原文值,作用域括注;null → null(显示「未知」)', () => {
    expect(
      formatModelLimits([
        { label: '上下文窗口', text: '1M', scope: null },
        { label: '最大输出', text: '128K', scope: null },
      ]),
    ).toBe('上下文窗口 1M · 最大输出 128K')
    expect(
      formatModelLimits([{ label: '上下文窗口', text: '8K(预计 20 轮)', scope: '音频通话' }]),
    ).toBe('上下文窗口 8K(预计 20 轮)(音频通话)')
    expect(formatModelLimits(null)).toBeNull()
    expect(formatModelLimits([])).toBeNull()
  })

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
