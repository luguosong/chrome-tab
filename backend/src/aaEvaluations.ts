import type { ModelProviderId } from 'chrome-tab-shared'
import { asRec, str } from './common'

/**
 * Artificial Analysis 评测接入(issues/08,CONTEXT.md「评测结果」;研究 evaluations.md):
 * 免费 API(x-api-key,1000 请求/日,Key 只在服务端、结果缓存落库)。分数是**可更新快照**
 * ——每轮成功取数整表替换,漂移不产生动态,仅运行期「首次进入评测」产一条 evaluated
 * 动态(首配接入静默:真实首入日不可考,见 modelTracking.replaceEvaluationSnapshot)
 * (Benchmark 方法/版本变化免费 API 不暴露,不可检测——已知上限,注释即档)。
 * 归属只认映射内 slug 精确相等(不猜):人工核验存量(2026-08-25 sitemap)2026-09-05 起
 * 随 ADR-0058 迁入 model_aa_mapping 表;此后新模型由 aaAutoMappings 同名自动映射补表
 * (slug 归一与基线行精确相等 + creator 拦跨家,确定性规则非猜测)。AA 文档推荐 UUID
 * 但需 Key 才能取得,slug 失败模式安全(漂移即该模型评测静默消失=「留空」,不误归属)。
 * effort 变体(-high/-low/-non-reasoning…)与日期快照 slug 不映射——同模型多份评测
 * 会撞 (模型,评测方,Benchmark) 唯一键。
 */

/** AA 映射行(model_aa_mapping 表的运行时形态;runPoll 每轮从 DB 读出传入)。 */
export interface AaMappingRow {
  slug: string
  provider: ModelProviderId
  officialId: string
}

/** 映射查询表(行集 → Map,poll 每轮构建一次)。 */
export const aaMappingIndex = (rows: readonly AaMappingRow[]): ReadonlyMap<string, { provider: ModelProviderId; officialId: string }> =>
  new Map(rows.map((r) => [r.slug, { provider: r.provider, officialId: r.officialId }]))

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

// ---- 纯函数(解析与匹配;防御式读取沿用 common 的 asRec/str 先例)----

/** AA 端点响应里的一个模型条目(解析后的统一形态;llm 带 evaluations、媒体带 elo)。 */
export interface AaEntry {
  slug: string
  name: string
  /** model_creator.slug(上游官方归属;媒体端点无此字段 → null,LLM 端点 2026-09-01 实测)。 */
  creator: string | null
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
      creator: str(asRec(e?.model_creator) ?? {}, 'slug'),
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
export function aaRowsFromLlms(json: string, mapping: ReadonlyMap<string, { provider: ModelProviderId; officialId: string }>): AaEvalRow[] {
  const entries = parseAaEntries(json)
  if (entries.length === 0) throw new Error('AA LLM 端点零模型(疑似上游改版)')
  return matchEntries(entries, mapping, (e) =>
    Object.entries(e.evaluations).map(([benchmark, score]) => ({ benchmark, score })),
  )
}

/** 媒体端点条目 → 评测行(benchmark = 端点对应 key,如 text_to_image_elo)。空榜为合法态(只返在榜模型)。 */
export function aaRowsFromMedia(json: string, benchmark: string, mapping: ReadonlyMap<string, { provider: ModelProviderId; officialId: string }>): AaEvalRow[] {
  return matchEntries(parseAaEntries(json), mapping, (e) => (e.elo === null ? [] : [{ benchmark, score: e.elo }]))
}

function matchEntries(
  entries: AaEntry[],
  mapping: ReadonlyMap<string, { provider: ModelProviderId; officialId: string }>,
  scoresOf: (e: AaEntry) => Array<{ benchmark: string; score: number }>,
): AaEvalRow[] {
  const rows: AaEvalRow[] = []
  for (const e of entries) {
    const m = mapping.get(e.slug)
    if (m === undefined) continue
    for (const { benchmark, score } of scoresOf(e)) {
      rows.push({ ...m, benchmark, score, version: e.name, url: aaModelUrl(e.slug) })
    }
  }
  return rows
}

// ---- 同名自动映射(ADR-0058:「AA 已收录、基线有同名行、映射缺」从落线索升级为直接补表)----

/**
 * AA model_creator.slug → 跟踪厂家(代码即配置;2026-09-01 线上 LLM 端点实测核验
 * ——智谱在 AA 是 "Z AI"/zai、月暗是 "Kimi"/kimi)。creator slug 会漂移(旧抓取口径
 * 曾为 'zhipu'),未知值防御跳过:归属由同名基线行决定,creator 只作交叉校验,漏检
 * 后果安全;媒体端点无 creator 字段,单条件同名照跑。
 */
const AA_CREATOR_MAP: Partial<Record<string, ModelProviderId>> = {
  zai: 'zhipu',
  openai: 'openai',
  anthropic: 'anthropic',
  xai: 'xai',
  kimi: 'moonshot',
  alibaba: 'alibaba',
  deepseek: 'deepseek',
}

/** 同名归一:小写 + 圆点作连字符(AA slug 形态,如 glm-4-7 ↔ 基线 glm-4.7)。已知
 * 上限:AA 个别 slug 省略圆点(如 gpt-35-turbo ↔ gpt-3.5-turbo)归一后不相等——该
 * 形态漏检(无线索,后果安全),由人工映射表兜底,不为此扩归一(形态集合开放,
 * 每扩一种就多一类误撞面)。 */
const aaSlugNorm = (s: string): string => s.toLowerCase().replaceAll('.', '-')

/**
 * 端点响应 → 同名自动映射(ADR-0058):AA 条目 slug 归一后与**同厂家基线行**
 * (officialId/matchAliases)精确相等、但不在现有映射 → 直接产出映射行(调用方
 * upsert 进 model_aa_mapping,verified='auto')。同名确定性规则非猜测:归属来自基线
 * 行;条目带 creator 且与行厂家不一致 → 跳过(防跨家撞名);未知值放行——同名本身
 * 即归属证据。**唯一目标守卫**:一行基线只允许一个映射 slug——行已被某 slug 映射时
 * 其余别名 slug 不再补(同模型双 slug 会撞 model_evaluations 的
 * UNIQUE(model_id, evaluator, benchmark),快照事务崩、评测永久陈旧)。变体/快照/
 * 基线外新模型与基线行不同名,天然不落(由厂家信源的残余 ID 线索→auto 核验链覆盖)。
 * formerly aaUnmappedClues(落线索人工补映射,2026-09-05「当天时效」grill 定案翻转
 * 为自动补表)。
 */
export function aaAutoMappings(
  json: string,
  baselines: readonly AaBaselineRef[],
  /** 现有映射:slug → 目标(provider|officialId)。 */
  existing: ReadonlyMap<string, string>,
): AaMappingRow[] {
  const known = new Map(
    baselines.flatMap((b) =>
      [b.officialId, ...b.matchAliases].map((id) => [aaSlugNorm(id), { provider: b.provider, officialId: b.officialId }] as const),
    ),
  )
  const mappedTargets = new Set(existing.values())
  const out: AaMappingRow[] = []
  for (const e of parseAaEntries(json)) {
    if (existing.has(e.slug)) continue
    const hit = known.get(aaSlugNorm(e.slug))
    if (hit === undefined) continue
    // creator 已知且指向**别家**才拦(防跨家撞名);未知值放行——同名本身即归属证据,
    // 未知值跳过会让 creator slug 漂移(如旧口径 'zhipu')静默失能整个信号
    const creatorProvider = e.creator !== null ? AA_CREATOR_MAP[e.creator] : undefined
    if (creatorProvider !== undefined && creatorProvider !== hit.provider) continue
    // 唯一目标守卫:该基线行已有别的 slug 映射 → 不补(评测唯一键)
    if (mappedTargets.has(`${hit.provider}|${hit.officialId}`)) continue
    out.push({ slug: e.slug, provider: hit.provider, officialId: hit.officialId })
  }
  return out
}

/** aaAutoMappings 的基线入参(officialId + matchAliases 都参与同名判定;DB 行含 provider)。 */
export interface AaBaselineRef {
  provider: ModelProviderId
  officialId: string
  matchAliases: readonly string[]
}

/** 快照日期(YYYY-MM-DD,北京时间)——与前端 24h 红点的北京时间锚点同口径。 */
export function beijingToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10)
}
