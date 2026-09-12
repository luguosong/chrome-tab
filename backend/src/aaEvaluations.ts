import type { ModelEvaluationsStatus, ModelProviderId, TrackedModel } from 'chrome-tab-shared'
import { asRec, str } from './common'
import type { Db } from './db'
import seedJson from './modelBaselineSeed.json'

/**
 * Artificial Analysis 评测接入(issues/08,CONTEXT.md「评测结果」;研究 evaluations.md):
 * 免费 API(x-api-key,1000 请求/日,Key 只在服务端、结果缓存落库)。分数是**可更新快照**
 * ——每轮成功取数整表替换,漂移不产生动态,仅运行期「首次进入评测」产一条 evaluated
 * 动态(首配接入静默:真实首入日不可考,见 replaceEvaluationSnapshot)
 * (Benchmark 方法/版本变化免费 API 不暴露,不可检测——已知上限,注释即档)。
 * 归属只认映射内 slug 精确相等(不猜):人工核验存量(2026-08-25 sitemap)2026-09-05 起
 * 随 ADR-0058 迁入 model_aa_mapping 表;此后新模型由 aaAutoMappings 同名自动映射补表
 * (slug 归一与基线行精确相等 + creator 拦跨家,确定性规则非猜测)。AA 文档推荐 UUID
 * 但需 Key 才能取得,slug 失败模式安全(漂移即该模型评测静默消失=「留空」,不误归属)。
 * effort 变体(-high/-low/-non-reasoning…)与日期快照 slug 不映射——同模型多份评测
 * 会撞 (模型,评测方,Benchmark) 唯一键。
 */

/** AA 映射行(model_aa_mapping 表的运行时形态;poll 每轮从 DB 读出)。 */
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

// ---- 生命周期(六路取数、映射落库、快照、状态与读侧投影;IO 经参数注入,测试零真网)----

const nowIso = () => new Date().toISOString()

/** 种子的 aaMapping 段(人工核验映射存量;models 段归 modelTracking 读)。 */
const SEED_AA_MAPPING = (seedJson as { aaMapping: AaMappingRow[] }).aaMapping

/**
 * 「评测结果」生命周期模块(架构评审 2026-09-12 候选 02,.scratch/评测生命周期/01):
 * 六路取数、同名自动映射落库、快照替换与首入评测动态、陈旧状态与读侧投影的单点;
 * 模型档案写入、线索账本与厂家取数编排不在其内——model_archive 仅作只读输入(自动
 * 映射的基线 refs 与快照行的 idOf)。ModelTrackingService 构造时持有一个实例,init
 * 编排:bootstrapFromSeed → ensureSeeded → 首轮 poll(**时序契约**:aaMapping 种子
 * 必须先于首轮 poll,否则空映射表会让同名自动映射把人工核验存量以 verified='auto' 重灌)。
 */
export function makeAaEvaluations(
  db: Pick<Db, 'selectFrom' | 'insertInto' | 'deleteFrom' | 'transaction'>,
  fetchText: (url: string, timeoutMs: number, init?: RequestInit) => Promise<string>,
  /** Artificial Analysis API Key(issues/08);空串 = 未配置:评测轮询整体跳过,读侧 configured=false。 */
  aaApiKey = '',
) {
  /** 空库灌 aaMapping 种子(人工核验存量);幂等。 */
  async function ensureSeeded(): Promise<void> {
    const aaExisting = await db.selectFrom('model_aa_mapping').select('slug').execute()
    if (aaExisting.length === 0) {
      for (const m of SEED_AA_MAPPING) {
        await db
          .insertInto('model_aa_mapping')
          .values({
            slug: m.slug,
            provider: m.provider,
            official_id: m.officialId,
            verified: 'manual',
            created_at: nowIso(),
            updated_at: nowIso(),
          })
          .execute()
      }
    }
  }

  /** AA 映射表全量读(model_aa_mapping;poll 每轮一次)。 */
  async function readAaMappings(): Promise<AaMappingRow[]> {
    const rows = await db
      .selectFrom('model_aa_mapping')
      .select(['slug', 'provider', 'official_id'])
      .execute()
    return rows.map((r) => ({
      slug: r.slug,
      provider: r.provider as ModelProviderId,
      officialId: r.official_id,
    }))
  }

  /**
   * 评测一轮(issues/08):LLM 主表 + 五个媒体榜单六路取数(单 Key 限额 1000/日,ADR-0058 起
   * 2h 节奏 ×6 路 ≈ 72 请求/日,远低于限额;结果落库即缓存,满足 API 缓存要求)。任一路
   * 失败 → 整轮按评测源失败处理:保留最后成功快照、只标评测陈旧,不影响任何厂家档案。
   * 未配置 Key 时整体 no-op(不取数、不写状态)。分数漂移只更新快照行(不产动态);
   * 唯产动态的口径 = 运行期模型首次获得评测行(kind 'evaluated',首配接入整轮静默;
   * Benchmark 方法/版本变化免费 API 不暴露、不可检测,为已知上限)。
   */
  async function poll(): Promise<void> {
    if (aaApiKey === '') return
    try {
      const headers = { 'x-api-key': aaApiKey }
      const llmJson = await fetchText(AA_LLM_URL, 30_000, { headers })
      // 同名自动映射(ADR-0058,formerly aaUnmappedClues 落线索):LLM 主表条目 slug
      // 归一与基线行同名且不在映射表 → 直接 upsert(verified='auto')——媒体端点不参与
      // (无 creator 且 slug 带厂商前缀,同名误配风险)。upsert 失败只记日志不炸评测轮。
      const mappingRows = await readAaMappings()
      const archiveRefs = await db
        .selectFrom('model_archive')
        .select(['provider', 'official_id', 'match_aliases'])
        .execute()
      const refs: AaBaselineRef[] = archiveRefs.map((r) => ({
        provider: r.provider as ModelProviderId,
        officialId: r.official_id,
        matchAliases: JSON.parse(r.match_aliases) as string[],
      }))
      const autos = aaAutoMappings(llmJson, refs, new Map(mappingRows.map((r) => [r.slug, `${r.provider}|${r.officialId}`])))
      for (const m of autos) {
        await db
          .insertInto('model_aa_mapping')
          .values({
            slug: m.slug,
            provider: m.provider,
            official_id: m.officialId,
            verified: 'auto',
            created_at: nowIso(),
            updated_at: nowIso(),
          })
          .onConflict((oc) => oc.column('slug').doNothing())
          .execute()
          .catch((e: unknown) => console.warn(`模型追踪 AA 自动映射 ${m.slug} 落库失败:`, e))
      }
      // 映射(含本轮自动新增)→ 评测行;自动映射的 slug 当轮即带上分数
      const mapping = aaMappingIndex([...mappingRows, ...autos])
      const rows: AaEvalRow[] = [...aaRowsFromLlms(llmJson, mapping)]
      for (const ep of AA_MEDIA_ENDPOINTS) {
        rows.push(...aaRowsFromMedia(await fetchText(ep.url, 30_000, { headers }), ep.benchmark, mapping))
      }
      await replaceEvaluationSnapshot(rows)
      await markEvalStatus(true)
    } catch (e) {
      await markEvalStatus(false).catch(() => {})
      throw e
    }
  }

  /** 快照整表替换(单事务:删旧插新 + 运行期首入评测动态;首配接入静默),幂等。 */
  async function replaceEvaluationSnapshot(rows: AaEvalRow[]): Promise<void> {
    const archive = await db
      .selectFrom('model_archive')
      .select(['id', 'provider', 'official_id'])
      .execute()
    const idOf = new Map(archive.map((r) => [`${r.provider}|${r.official_id}`, r.id]))
    const snapshotDate = beijingToday()
    const inserts = rows.flatMap((r) => {
      const modelId = idOf.get(`${r.provider}|${r.officialId}`)
      return modelId === undefined
        ? [] // 映射指向的基线行不存在(基线演进滞后)→ 跳过,不炸轮询
        : [{
            model_id: modelId,
            evaluator: AA_EVALUATOR,
            benchmark: r.benchmark,
            score: r.score,
            version: r.version,
            url: r.url,
            snapshot_date: snapshotDate,
          }]
    })
    const newModelIds = new Set(inserts.map((r) => r.model_id))
    const existing = await db
      .selectFrom('model_evaluations')
      .select('model_id')
      .where('evaluator', '=', AA_EVALUATOR)
      .execute()
    const existingIds = new Set(existing.map((r) => r.model_id))
    // 首配接入(替换前快照表无任何 AA 行而本轮有行):映射内模型早已被 AA 收录,
    // 真实「首次进入评测」日期不可考——occurred_on 只会得到取数日的伪日期(issues/08
    // 部署回灌教训:83 模型同日伪动态集体顶掉真实时间线)。接入是系统事件而非模型
    // 动态,整轮静默;此后运行期新出现的模型才以发现日为 occurred_on 产动态。
    const eventModelIds = existingIds.size === 0 && inserts.length > 0 ? [] : newModelIds
    const firstUrlOf = new Map(
      rows.flatMap((r) => {
        const modelId = idOf.get(`${r.provider}|${r.officialId}`)
        return modelId === undefined ? [] : ([[modelId, r.url] as const] as const)
      }),
    )
    await db.transaction().execute(async (trx) => {
      await trx.deleteFrom('model_evaluations').where('evaluator', '=', AA_EVALUATOR).execute()
      if (inserts.length > 0) {
        await trx.insertInto('model_evaluations').values(inserts).execute()
      }
      for (const modelId of eventModelIds) {
        if (existingIds.has(modelId)) continue
        await trx
          .insertInto('model_events')
          .values({
            model_id: modelId,
            kind: 'evaluated',
            occurred_on: snapshotDate,
            title: `进入 ${AA_EVALUATOR_LABEL} 评测`,
            source_url: firstUrlOf.get(modelId)!,
            created_at: nowIso(),
          })
          .onConflict((oc) =>
            oc.columns(['model_id', 'kind', 'occurred_on', 'source_url']).doNothing(),
          )
          .execute()
      }
    })
  }

  /** 评测源状态(独立于厂家信源的 model_fetch_status;同 upsert 口径)。 */
  async function markEvalStatus(ok: boolean): Promise<void> {
    const now = nowIso()
    await db
      .insertInto('model_evaluation_status')
      .values({
        evaluator: AA_EVALUATOR,
        stale: ok ? 0 : 1,
        last_success_at: ok ? now : null,
        last_attempt_at: now,
      })
      .onConflict((oc) =>
        oc.column('evaluator').doUpdateSet({
          stale: ok ? 0 : 1,
          ...(ok ? { last_success_at: now } : {}),
          last_attempt_at: now,
        }),
      )
      .execute()
  }

  /** 读侧:按模型聚合的评测行(wire 形态直出——展示名投影是评测方知识,archive 只组装)。 */
  async function byModel(): Promise<Map<number, TrackedModel['evaluations']>> {
    const evalRows = await db
      .selectFrom('model_evaluations')
      .selectAll()
      .where('evaluator', '=', AA_EVALUATOR)
      .execute()
    const byModel = new Map<number, TrackedModel['evaluations']>()
    for (const r of evalRows) {
      const list = byModel.get(r.model_id) ?? []
      list.push({
        evaluator: AA_EVALUATOR_LABEL,
        benchmark: r.benchmark,
        score: r.score,
        version: r.version,
        date: r.snapshot_date,
        url: r.url,
      })
      byModel.set(r.model_id, list)
    }
    return byModel
  }

  /** 读侧:评测源信封(未配置恒不陈旧、无成功时间,前端评测区显示「未配置」)。 */
  async function status(): Promise<ModelEvaluationsStatus> {
    const evalStatus = await db
      .selectFrom('model_evaluation_status')
      .selectAll()
      .where('evaluator', '=', AA_EVALUATOR)
      .executeTakeFirst()
    return {
      configured: aaApiKey !== '',
      stale: evalStatus === undefined ? false : evalStatus.stale === 1,
      lastSuccessAt: evalStatus?.last_success_at ?? null,
    }
  }

  return { ensureSeeded, poll, byModel, status }
}

export type AaEvaluations = ReturnType<typeof makeAaEvaluations>
