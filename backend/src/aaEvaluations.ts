import type { ModelProviderId } from 'chrome-tab-shared'
import { asRec, str, type Rec } from './common'

/**
 * Artificial Analysis 评测接入(issues/08,CONTEXT.md「评测结果」;研究 evaluations.md):
 * 免费 API(x-api-key,1000 请求/日,Key 只在服务端、结果缓存落库)。分数是**可更新快照**
 * ——每轮成功取数整表替换,漂移不产生动态,仅「首次进入评测」产一条 evaluated 动态
 * (Benchmark 方法/版本变化免费 API 不暴露,不可检测——已知上限,注释即档)。
 * 归属只认映射表内 slug 精确相等(不猜):映射以 2026-08-25 站点 sitemap 的公开模型页
 * slug 人工核验;AA 文档推荐 UUID 但需 Key 才能取得,slug 失败模式安全(漂移即该模型
 * 评测静默消失=「留空」,不误归属)。effort 变体(-high/-low/-non-reasoning…)与日期
 * 快照 slug 不映射——同模型多份评测会撞 (模型,评测方,Benchmark) 唯一键。
 */

/** 评测方标识(库内 evaluator 列值)与展示名。 */
export const AA_EVALUATOR = 'artificial_analysis'
export const AA_EVALUATOR_LABEL = 'Artificial Analysis'

export const AA_BASE_URL = 'https://artificialanalysis.ai/api/v2'
/** LLM 主表(语言/多模态理解模型,`evaluations` 对象逐 Benchmark 给分)。 */
export const AA_LLM_URL = `${AA_BASE_URL}/data/llms/models`
/** 媒体榜单(只返当前在榜的一方基础模型;Elo 即分数,rank 不入库——榜单位置可由原链查看)。 */
export const AA_MEDIA_ENDPOINTS = [
  { url: `${AA_BASE_URL}/data/media/text-to-image`, benchmark: 'text_to_image_elo' },
  { url: `${AA_BASE_URL}/data/media/image-editing`, benchmark: 'image_editing_elo' },
  { url: `${AA_BASE_URL}/data/media/text-to-speech`, benchmark: 'text_to_speech_elo' },
  { url: `${AA_BASE_URL}/data/media/text-to-video`, benchmark: 'text_to_video_elo' },
  { url: `${AA_BASE_URL}/data/media/image-to-video`, benchmark: 'image_to_video_elo' },
] as const

/** 模型页链接(评测行原始链接,全端点统一;slug 即映射键)。 */
export const aaModelUrl = (slug: string) => `https://artificialanalysis.ai/models/${slug}`

/**
 * AA slug → 跟踪模型(代码即配置,同 ADR-0025 基线口径;issues/08 人工核验:
 * 2026-08-25 sitemap,基线内有对应公开模型页者才收录)。键为 AA slug(圆点作连字符,
 * 如 glm-4-7 = GLM-4.7;Anthropic 新序 claude-4-5-haiku = Claude Haiku 4.5、
 * claude-4-1-opus = Claude Opus 4.1;xAI 语音 speech-to-text = grok-stt、
 * text-to-speech = xai-text-to-speech;图像编辑页 gpt_image_1-5 = GPT-Image-1.5)。
 * 未收录 = AA 无该模型页或无法精确对应(留空);新模型上线 AA 后随此表人工纳入。
 */
export const AA_MODEL_MAP: Record<string, { provider: ModelProviderId; officialId: string }> = {
  // 智谱
  'glm-5-3': { provider: 'zhipu', officialId: 'glm-5.3' },
  'glm-5-2': { provider: 'zhipu', officialId: 'glm-5.2' },
  'glm-5-1': { provider: 'zhipu', officialId: 'glm-5.1' },
  'glm-5': { provider: 'zhipu', officialId: 'glm-5' },
  'glm-4-7': { provider: 'zhipu', officialId: 'glm-4.7' },
  'glm-4-7-flash': { provider: 'zhipu', officialId: 'glm-4.7-flash' },
  'glm-4-6': { provider: 'zhipu', officialId: 'glm-4.6' },
  'glm-4-5-air': { provider: 'zhipu', officialId: 'glm-4.5-air' },
  'glm-4-6v': { provider: 'zhipu', officialId: 'glm-4.6v' },
  // OpenAI(LLM)
  'gpt-5-6-sol': { provider: 'openai', officialId: 'gpt-5.6-sol' },
  'gpt-5-6-terra': { provider: 'openai', officialId: 'gpt-5.6-terra' },
  'gpt-5-6-luna': { provider: 'openai', officialId: 'gpt-5.6-luna' },
  'gpt-5-5': { provider: 'openai', officialId: 'gpt-5.5' },
  'gpt-5-4': { provider: 'openai', officialId: 'gpt-5.4' },
  'gpt-5-4-pro': { provider: 'openai', officialId: 'gpt-5.4-pro' },
  'gpt-5-4-mini': { provider: 'openai', officialId: 'gpt-5.4-mini' },
  'gpt-5-4-nano': { provider: 'openai', officialId: 'gpt-5.4-nano' },
  'gpt-5-3-codex': { provider: 'openai', officialId: 'gpt-5.3-codex' },
  'gpt-5-2': { provider: 'openai', officialId: 'gpt-5.2' },
  'gpt-5-2-codex': { provider: 'openai', officialId: 'gpt-5.2-codex' },
  'gpt-5-1': { provider: 'openai', officialId: 'gpt-5.1' },
  'gpt-5-1-codex': { provider: 'openai', officialId: 'gpt-5.1-codex' },
  'gpt-5-1-codex-mini': { provider: 'openai', officialId: 'gpt-5.1-codex-mini' },
  'gpt-5': { provider: 'openai', officialId: 'gpt-5' },
  'gpt-5-mini': { provider: 'openai', officialId: 'gpt-5-mini' },
  'gpt-5-nano': { provider: 'openai', officialId: 'gpt-5-nano' },
  'gpt-5-codex': { provider: 'openai', officialId: 'gpt-5-codex' },
  'gpt-4-1': { provider: 'openai', officialId: 'gpt-4.1' },
  'gpt-4-1-mini': { provider: 'openai', officialId: 'gpt-4.1-mini' },
  'gpt-4-1-nano': { provider: 'openai', officialId: 'gpt-4.1-nano' },
  'gpt-4o': { provider: 'openai', officialId: 'gpt-4o' },
  'gpt-4o-mini': { provider: 'openai', officialId: 'gpt-4o-mini' },
  'gpt-4': { provider: 'openai', officialId: 'gpt-4' },
  'gpt-4-turbo': { provider: 'openai', officialId: 'gpt-4-turbo' },
  'gpt-35-turbo': { provider: 'openai', officialId: 'gpt-3.5-turbo' },
  o1: { provider: 'openai', officialId: 'o1' },
  'o1-preview': { provider: 'openai', officialId: 'o1-preview' },
  'o1-pro': { provider: 'openai', officialId: 'o1-pro' },
  o3: { provider: 'openai', officialId: 'o3' },
  'o3-mini': { provider: 'openai', officialId: 'o3-mini' },
  'o3-pro': { provider: 'openai', officialId: 'o3-pro' },
  'o4-mini': { provider: 'openai', officialId: 'o4-mini' },
  'gpt-oss-120b': { provider: 'openai', officialId: 'gpt-oss-120b' },
  'gpt-oss-20b': { provider: 'openai', officialId: 'gpt-oss-20b' },
  // OpenAI(媒体榜单;whisper/gpt-realtime-whisper 属 STT 榜,免费 API 暂无该端点,映射先入档)
  'gpt-image-2': { provider: 'openai', officialId: 'gpt-image-2' },
  'openai-gpt_image-1-5': { provider: 'openai', officialId: 'gpt-image-1.5' },
  'sora-2-pro': { provider: 'openai', officialId: 'sora-2-pro' },
  'gpt-realtime-2': { provider: 'openai', officialId: 'gpt-realtime-2' },
  'openai-gpt-realtime-whisper': { provider: 'openai', officialId: 'gpt-realtime-whisper' },
  whisper: { provider: 'openai', officialId: 'whisper-1' },
  'tts-1': { provider: 'openai', officialId: 'tts-1' },
  'tts-1-hd': { provider: 'openai', officialId: 'tts-1-hd' },
  // Anthropic
  'claude-fable-5': { provider: 'anthropic', officialId: 'claude-fable-5' },
  'claude-opus-5': { provider: 'anthropic', officialId: 'claude-opus-5' },
  'claude-sonnet-5': { provider: 'anthropic', officialId: 'claude-sonnet-5' },
  'claude-4-5-haiku': { provider: 'anthropic', officialId: 'claude-haiku-4-5' },
  'claude-opus-4-8': { provider: 'anthropic', officialId: 'claude-opus-4-8' },
  'claude-opus-4-7': { provider: 'anthropic', officialId: 'claude-opus-4-7' },
  'claude-opus-4-6': { provider: 'anthropic', officialId: 'claude-opus-4-6' },
  'claude-opus-4-5': { provider: 'anthropic', officialId: 'claude-opus-4-5' },
  'claude-sonnet-4-6': { provider: 'anthropic', officialId: 'claude-sonnet-4-6' },
  'claude-4-5-sonnet': { provider: 'anthropic', officialId: 'claude-sonnet-4-5' },
  'claude-4-1-opus': { provider: 'anthropic', officialId: 'claude-opus-4-1' },
  'claude-4-opus': { provider: 'anthropic', officialId: 'claude-opus-4' },
  'claude-4-sonnet': { provider: 'anthropic', officialId: 'claude-sonnet-4' },
  'claude-3-7-sonnet': { provider: 'anthropic', officialId: 'claude-3-7-sonnet' },
  'claude-3-haiku': { provider: 'anthropic', officialId: 'claude-3-haiku' },
  // xAI(grok-build-0-1-06-16 = Grok Build 0.1 的 06-16 固定形态;-0309 系同理双形态各归各行)
  'grok-4-6': { provider: 'xai', officialId: 'grok-4.6' },
  'grok-4-5': { provider: 'xai', officialId: 'grok-4.5' },
  'grok-4-3': { provider: 'xai', officialId: 'grok-4.3' },
  'grok-build-0-1-06-16': { provider: 'xai', officialId: 'grok-build-0.1' },
  'grok-4-20-0309': { provider: 'xai', officialId: 'grok-4.20-0309-reasoning' },
  'grok-4-20-0309-non-reasoning': { provider: 'xai', officialId: 'grok-4.20-0309-non-reasoning' },
  'grok-imagine-video': { provider: 'xai', officialId: 'grok-imagine-video' },
  'grok-stt': { provider: 'xai', officialId: 'speech-to-text' },
  'xai-text-to-speech': { provider: 'xai', officialId: 'text-to-speech' },
  // 月之暗面(kimi-k2-0905 等日期快照不映射)
  'kimi-k3': { provider: 'moonshot', officialId: 'kimi-k3' },
  'kimi-k2-7-code': { provider: 'moonshot', officialId: 'kimi-k2.7-code' },
  'kimi-k2-6': { provider: 'moonshot', officialId: 'kimi-k2.6' },
  'kimi-k2-5': { provider: 'moonshot', officialId: 'kimi-k2.5' },
  'kimi-k2': { provider: 'moonshot', officialId: 'kimi-k2' },
  'kimi-k2-thinking': { provider: 'moonshot', officialId: 'kimi-k2-thinking' },
  // DeepSeek(-0324/-0120/-0925/-0420/-0424 日期快照与 -terminus 固定形态不映射,归并家族行)
  'deepseek-v4-pro': { provider: 'deepseek', officialId: 'deepseek-v4-pro' },
  'deepseek-v4-flash': { provider: 'deepseek', officialId: 'deepseek-v4-flash' },
  'deepseek-v3-2': { provider: 'deepseek', officialId: 'deepseek-v3.2' },
  'deepseek-v3-1': { provider: 'deepseek', officialId: 'deepseek-v3.1' },
  'deepseek-r1': { provider: 'deepseek', officialId: 'deepseek-r1' },
  'deepseek-v3': { provider: 'deepseek', officialId: 'deepseek-v3' },
}

// ---- 纯函数(解析与匹配;防御式读取沿用 common 的 asRec/str 先例)----

/** AA 端点响应里的一个模型条目(解析后的统一形态;llm 带 evaluations、媒体带 elo)。 */
export interface AaEntry {
  slug: string
  name: string
  /** llm 端点:benchmark key → 分数(只留有限数值;媒体端点为空对象,elo 单列)。 */
  evaluations: Record<string, number>
  /** 媒体端点的 Elo;无/非数值 → null。 */
  elo: number | null
}

/** JSON 文本 → 条目数组。data 非数组/条目缺 slug → 抛(调用方按取数失败标陈旧)。 */
export function parseAaEntries(json: string): AaEntry[] {
  const root = asRec(JSON.parse(json))
  const data = root?.data
  if (!Array.isArray(data)) throw new Error('AA 响应缺 data 数组(疑似上游改版)')
  const out: AaEntry[] = []
  for (const raw of data) {
    const e = asRec(raw)
    const slug = str(e, 'slug')
    if (slug === null) continue
    const evaluations: Record<string, number> = {}
    for (const [k, v] of Object.entries(asRec(e?.evaluations) ?? {})) {
      if (typeof v === 'number' && Number.isFinite(v)) evaluations[k] = v
    }
    const elo = e?.elo
    out.push({
      slug,
      name: str(e, 'name') ?? slug,
      evaluations,
      elo: typeof elo === 'number' && Number.isFinite(elo) ? elo : null,
    })
  }
  return out
}

/** 解析后的评测行(尚未落库;version/url 随行携带,满足可回链与版本留存)。 */
export interface AaEvalRow {
  provider: ModelProviderId
  officialId: string
  benchmark: string
  score: number
  version: string
  url: string
}

/**
 * LLM 端点条目 → 评测行。仅映射表内 slug 产生行(evaluations 键集不设白名单——AA
 * 基准集随方法演进,数值项原样透传,前端映射展示名);零模型条目 = 上游改版,抛错。
 */
export function aaRowsFromLlms(json: string): AaEvalRow[] {
  const entries = parseAaEntries(json)
  if (entries.length === 0) throw new Error('AA LLM 端点零模型(疑似上游改版)')
  return matchEntries(entries, (e) =>
    Object.entries(e.evaluations).map(([benchmark, score]) => ({ benchmark, score })),
  )
}

/** 媒体端点条目 → 评测行(benchmark = 端点对应 key,如 text_to_image_elo)。空榜为合法态(只返在榜模型)。 */
export function aaRowsFromMedia(json: string, benchmark: string): AaEvalRow[] {
  return matchEntries(parseAaEntries(json), (e) => (e.elo === null ? [] : [{ benchmark, score: e.elo }]))
}

function matchEntries(entries: AaEntry[], scoresOf: (e: AaEntry) => Array<{ benchmark: string; score: number }>): AaEvalRow[] {
  const rows: AaEvalRow[] = []
  for (const e of entries) {
    const m = AA_MODEL_MAP[e.slug]
    if (m === undefined) continue
    for (const { benchmark, score } of scoresOf(e)) {
      rows.push({ ...m, benchmark, score, version: e.name, url: aaModelUrl(e.slug) })
    }
  }
  return rows
}

/** 快照日期(YYYY-MM-DD,北京时间)——与前端 24h 红点的北京时间锚点同口径。 */
export function beijingToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10)
}
