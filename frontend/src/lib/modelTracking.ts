import type {
  AvailabilityMode,
  ModelEventKind,
  ModelKind,
  ModelLimit,
  ModelPricing,
  ModelProviderId,
  ReleaseStage,
} from 'chrome-tab-shared'

/**
 * 模型追踪的展示语汇(CONTEXT.md「模型种类/发布阶段/开放方式/模型动态」的中文标签)
 * 与 24h 红点窗口推导。纯函数可直测;wire 类型在 chrome-tab-shared(ADR-0018)。
 */

/** 模型种类八类的展示名(与 CONTEXT.md「模型种类」词条的枚举一字不差)。 */
export const MODEL_KIND_LABELS: Record<ModelKind, string> = {
  text: '文本',
  multimodal_understanding: '多模态理解',
  image_generation: '图像生成',
  video_generation: '视频生成',
  audio_speech: '音频/语音',
  embedding: '向量',
  rerank: '重排',
  moderation_classification: '审核/分类',
}

/** 发布阶段展示名(厂家原文风格保留,不硬译)。 */
export const STAGE_LABELS: Record<ReleaseStage, string> = {
  experimental: 'Experimental',
  preview: 'Preview',
  beta: 'Beta',
  ga: 'GA',
  deprecated: '弃用中',
  retired: '已退役',
}

export const AVAILABILITY_LABELS: Record<AvailabilityMode, string> = {
  api: 'API',
  first_party_app: '厂家产品',
  open_weights: '开放权重',
}

export const EVENT_KIND_LABELS: Record<ModelEventKind, string> = {
  released: '发布',
  api_available: 'API 上线',
  first_party_available: '产品可用',
  weights_available: '权重开放',
  updated: '更新',
  alias_repointed: '别名换指向',
  deprecated: '弃用预告',
  retired: '退役',
}

/** 厂家展示名(详情 Modal 的 tab 与行内厂家位共用;tab 随厂家票扩自动派生)。 */
export const PROVIDER_LABELS: Record<ModelProviderId, string> = {
  zhipu: '智谱',
  anthropic: 'Anthropic',
  xai: 'xAI',
}

/**
 * 动态发生时刻的锚点(ms):occurredOn 只有日期粒度(信源即如此),按**北京时间
 * 当日零点**锚定——日期粒度下的最诚实表达(对齐 AI 日报按出刊时刻推定的先例)。
 * 非法日期 → null。
 */
export function modelEventAnchorMs(occurredOn: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(occurredOn)) return null
  const ms = Date.parse(`${occurredOn}T00:00:00+08:00`)
  return Number.isNaN(ms) ? null : ms
}

/** 24h 时间驱动红点(满窗自隐、无已读概念,对齐更新日志/视频更新先例)。 */
export function isFreshModelEvent(occurredOn: string, nowMs = Date.now()): boolean {
  const anchor = modelEventAnchorMs(occurredOn)
  return anchor !== null && nowMs - anchor < 24 * 60 * 60 * 1000
}

/** occurredOn(YYYY-MM-DD,北京时间)→ 锚点 ISO(当日零点),供 timeAgo 消费;非法回 null。 */
export function modelEventIso(occurredOn: string): string | null {
  const ms = modelEventAnchorMs(occurredOn)
  return ms === null ? null : new Date(ms).toISOString()
}

/**
 * 限额条目 → 单行摘要「上下文窗口 1M · 最大输出 128K」(作用域原文括注);null/空 →
 * null(调用方显示「未知」——官方未披露,issues/02 缺省口径)。
 */
export function formatModelLimits(limits: ModelLimit[] | null): string | null {
  if (!limits || limits.length === 0) return null
  return limits
    .map((l) => (l.scope ? `${l.label} ${l.text}(${l.scope})` : `${l.label} ${l.text}`))
    .join(' · ')
}

/** 价格的展示形态:地区/平台作用域 + 逐条原文行(作用域括注);null/空 → null(显示「官方未披露」)。 */
export function formatModelPricing(pricing: ModelPricing | null): { region: string; lines: string[] } | null {
  if (!pricing || pricing.entries.length === 0) return null
  return {
    region: pricing.region,
    lines: pricing.entries.map((e) => (e.scope ? `${e.text}(${e.scope})` : e.text)),
  }
}
