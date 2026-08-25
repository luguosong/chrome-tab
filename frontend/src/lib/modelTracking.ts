import type {
  AvailabilityMode,
  ModelEventKind,
  ModelKind,
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
  evaluated: '进入评测',
  alias_repointed: '别名换指向',
  deprecated: '弃用预告',
  retired: '退役',
}

/** 厂家展示名(详情 Modal 的 tab 与行内厂家位共用;tab 随厂家票扩自动派生)。 */
export const PROVIDER_LABELS: Record<ModelProviderId, string> = {
  zhipu: '智谱',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  xai: 'xAI',
  moonshot: '月之暗面',
  deepseek: 'DeepSeek',
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

/** 价格的展示形态:地区/平台作用域 + 逐条原文行(作用域括注);null/空 → null(显示「官方未披露」)。 */
export function formatModelPricing(pricing: ModelPricing | null): { region: string; lines: string[] } | null {
  if (!pricing || pricing.entries.length === 0) return null
  return {
    region: pricing.region,
    lines: pricing.entries.map((e) => (e.scope ? `${e.text}(${e.scope})` : e.text)),
  }
}

/**
 * 评测方归因链接(CONTEXT.md「评测结果」:评测方数据须归因;Artificial Analysis 免费
 * API 使用条款要求提供指向其站点的归因)。评测区头部统一挂一次,逐行不再重复。
 */
export const EVALUATION_ATTRIBUTION = { label: 'Artificial Analysis', url: 'https://artificialanalysis.ai/' }

/** 常见 Benchmark 展示名(后端透传 AA 原始 key;2026-08-25 线上实测校准,未收录 key 走 prettifyEvaluationKey 兜底)。 */
export const BENCHMARK_LABELS: Record<string, string> = {
  artificial_analysis_intelligence_index: 'AA 智能指数',
  artificial_analysis_coding_index: 'AA 编程指数',
  artificial_analysis_math_index: 'AA 数学指数',
  mmlu_pro: 'MMLU-Pro',
  gpqa: 'GPQA',
  hle: 'HLE',
  livecodebench: 'LiveCodeBench',
  scicode: 'SciCode',
  math_500: 'MATH-500',
  aime: 'AIME',
  aime_25: 'AIME 2025',
  lcr: 'AA-LCR',
  ifbench: 'IFBench',
  tau2: 'τ²',
  tau_banking: 'τ³-Banking',
  terminalbench_hard: 'Terminal-Bench Hard',
  terminalbench_v2_1: 'Terminal-Bench v2.1',
  text_to_image_elo: '文生图 Elo',
  image_editing_elo: '图像编辑 Elo',
  text_to_speech_elo: '语音合成 Elo',
  text_to_video_elo: '文生视频 Elo',
  image_to_video_elo: '图生视频 Elo',
}

/** 未收录 key 的兜底展示:下划线/连字符换空格、词首大写(评测方命名演进不致漏显示)。 */
export function prettifyEvaluationKey(key: string): string {
  return key
    .split(/[_-]+/)
    .filter(Boolean)
    .map((w) => (w.length <= 3 ? w.toUpperCase() : w[0]!.toUpperCase() + w.slice(1)))
    .join(' ')
}

export function benchmarkLabel(benchmark: string): string {
  return BENCHMARK_LABELS[benchmark] ?? prettifyEvaluationKey(benchmark)
}

/**
 * 比例型基准名单(原始分为 0–1 准确率,转百分比展示;2026-08-25 线上实测比例型全集)。
 * **按 key 判定而非数值区间**:指数类正值可能恰落 0–1(须显 0.5 非假 50%)。
 * AA 基准集演进时未收录的比例型 key 显示原始值——诚实但不百分比化,不猜。
 */
export const RATIO_BENCHMARKS = new Set([
  'mmlu_pro',
  'gpqa',
  'hle',
  'livecodebench',
  'scicode',
  'math_500',
  'aime',
  'aime_25',
  'lcr',
  'ifbench',
  'tau2',
  'tau_banking',
  'terminalbench_hard',
  'terminalbench_v2_1',
])

/**
 * 分数展示(Elo 大整数/指数/准确率三态;不跨基准归一,只做可读化):Elo → 整数;
 * 名单内准确率 → 百分比一位小数;其余(指数类,含负值)→ 原值四舍五入一位小数。
 */
export function formatEvaluationScore(benchmark: string, score: number): string {
  if (benchmark.endsWith('_elo')) return String(Math.round(score))
  if (RATIO_BENCHMARKS.has(benchmark)) return `${(score * 100).toFixed(1)}%`
  return (Math.round(score * 10) / 10).toFixed(1)
}
