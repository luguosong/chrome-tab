import type {
  AvailabilityMode,
  ModelEvent,
  ModelEventKind,
  ModelKind,
  ModelPricing,
  ModelProviderId,
  ReleaseStage,
  TrackedModel,
} from 'chrome-tab-shared'
import { timeAgo } from './timeAgo'

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

/**
 * 种类标签着色分类(2026-08-26):非文本模型彩色区分,染**种类标签**而非模型名——
 * 颜色挂在语义上(与展开区「值按语义着色」同纲),名称保持白色不破榜单扫读。
 * 分组而非逐类配色(八色不可记):文本世界(文本/多模态理解,输出以文字为中心)保持
 * 灰不占色;媒体生成三类暖色(pink/orange/lime,产出非文本内容);检索/安全基础设施
 * 三类冷色 indigo(向量/重排/审核,文本的配套管道)。色相全避开已占用语义色
 * (amber 价格/cyan 限额/violet 参数/emerald 成绩/accent 交互蓝/red 鲜度)。
 * 空串 = 沿用调用方默认灰。ModelKind 票扩时补映射(测试守全覆盖)。
 */
export const MODEL_KIND_COLOR_CLASSES: Record<ModelKind, string> = {
  text: '',
  multimodal_understanding: '',
  image_generation: 'text-pink-300',
  video_generation: 'text-orange-300',
  audio_speech: 'text-lime-300',
  embedding: 'text-indigo-300',
  rerank: 'text-indigo-300',
  moderation_classification: 'text-indigo-300',
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

/**
 * 最近动态简报「类型 · 相对时间」:小块滚动榜(ModelIcon)行尾文案(详情 Modal 列表
 * 2026-08-26 起改用 formatReleaseBrief 发布简报,动态明细展开区可看)。
 * 类型锚定防裸相对时间被读作发布时间——2026-08-26 线上症状:GPT-5.6 Sol 真实发布
 * 2026-07-09,行尾裸「5 天前」(= 08-21 降价动态)被读成「5 天前发布」。
 * occurredOn 非法(理论不可达,后端恒产日期串)时显示原串,不吞信息。
 */
export function formatLatestEventBrief(
  event: Pick<ModelEvent, 'kind' | 'occurredOn'>,
  now = Date.now(),
): string {
  const ago = timeAgo(modelEventIso(event.occurredOn), now)
  return ago === '' ? event.occurredOn : `${EVENT_KIND_LABELS[event.kind]} · ${ago}`
}

/** 「上线发布」类动态:发布锚点只认这些 kind(released 无产生点但预留,产生即纳入)。 */
const RELEASE_KINDS: ReadonlySet<ModelEventKind> = new Set([
  'released',
  'api_available',
  'first_party_available',
  'weights_available',
])

/**
 * 发布锚点(YYYY-MM-DD + 是否精确):可用类动态(released/api/产品/权重)中最早者 =
 * 「上线发布时间」(exact);无可用类动态的模型(如 gpt-5.6-cyber 仅 updated 行)回退
 * 最早动态(exact=false)——首条可证动态即最接近上线的时刻;无动态 → null(排序沉底)。
 * events 按 occurred_on 倒序返回,遍历结束时各变量即持有该类中日期最小者。
 * 排序(compareModelsByRelease)与详情行尾发布简报(formatReleaseBrief)共用。
 */
export function releaseAnchorOf(m: TrackedModel): { date: string; exact: boolean } | null {
  let fallback = ''
  let avail = ''
  for (const e of m.events) {
    if (RELEASE_KINDS.has(e.kind)) avail = e.occurredOn
    fallback = e.occurredOn
  }
  if (avail !== '') return { date: avail, exact: true }
  return fallback !== '' ? { date: fallback, exact: false } : null
}

/**
 * 详情 Modal 未展开行的右下角发布简报:绝对日期而非相对时间——发布轴即列表排序轴,
 * 行尾日期与排位单调一致可直接扫读比对,「48 天前」类相对表述对老模型信息量低。
 * 回退锚点(无可用类动态)标「见于」不标「发布」——首条可证动态 ≠ 发布,不谎称。
 * 无动态 → null(行尾留空)。2026-08-26 行尾由「最新动态简报」改为发布简报:更新动态
 * 抢占发布位使行尾被读作「最近才发布」;动态事件与时间在展开区时间线全量可看。
 */
export function formatReleaseBrief(m: TrackedModel): string | null {
  const anchor = releaseAnchorOf(m)
  if (anchor === null) return null
  return `${anchor.exact ? '发布' : '见于'} · ${anchor.date}`
}

/**
 * 模型列表展示排序(详情 Modal「全部」tab 与块内列表共用):可用模型按**上线发布时间**
 * 降序、退役沉底(CONTEXT.md「可用在前、已退役在后」),同日按 id 升序稳定。
 * 2026-08-26 排序轴由最新动态改为发布时间——按动态排使老模型(GPT-5.6 Sol 发布
 * 07-09)因降价等更新动态(08-21)被顶到新发布模型之前,读作「刚发布」;发布锚点
 * 取法见 releaseAnchorOf。无发布锚点与无动态模型均沉底(id 序在末段稳定)。
 * sort 原位排序,调用方须传拷贝(filter 返回的新数组可直接排)。
 */
export function compareModelsByRelease(a: TrackedModel, b: TrackedModel): number {
  const ra = a.stage === 'retired' ? 1 : 0
  const rb = b.stage === 'retired' ? 1 : 0
  if (ra !== rb) return ra - rb
  const da = releaseAnchorOf(a)?.date ?? ''
  const db = releaseAnchorOf(b)?.date ?? ''
  if (da !== db) return da < db ? 1 : -1
  return a.id - b.id
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
