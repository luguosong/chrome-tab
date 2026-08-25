import { schedule } from 'node-cron'
import { Hono } from 'hono'
import type {
  AvailabilityMode,
  ModelArchiveResponse,
  ModelEvent,
  ModelEventKind,
  ModelKind,
  ModelLimit,
  ModelPricing,
  ModelProviderId,
  ReleaseStage,
  TrackedModel,
} from 'chrome-tab-shared'
import { fetchText } from './common'
import type { Db } from './db'
import type { AuthEnv } from './auth'
import { ZHIPU_BASELINE } from './zhipuBaseline'

/**
 * 模型追踪(CONTEXT.md「模型追踪/跟踪模型/模型档案」;ADR-0025):全局单例图标的
 * 后端档案。与「AI 热点」的易失代理相反、与「视频更新」同为持久化轮询,但**无
 * user_id**——档案对所有用户共享,单个信源失败保留最后成功结果并标记陈旧
 * (model_fetch_status)。三段分工(研究 §6):**档案行(基本资料)只来自代码内
 * 人工核验基线**,部署即幂等 upsert 刷新;**模型动态来自厂家发布页确定性解析**
 * (智谱新品发布 Markdown 的 `<Update label description>` 块,日期粒度、按
 * 模型+类型+日期+信源去重);解析器**不认识**的更新块(基线外型号,含智谱平台
 * 托管的第三方模型)只作待核验线索跳过——待基线人工核验后纳入,这是「跟踪厂家」
 * 的定义性约束(不开放任意厂家/信源配置,理由见 ADR-0025)。
 */

// ---- 纯函数(解析与匹配;模块级 seam,无 IO)----

/** 智谱发布页一个更新块(解析后的统一形态)。 */
export interface ZhipuUpdate {
  /** YYYY-MM-DD(信源不补零的 label 归一化后)。 */
  date: string
  /** 块描述(announcement 标题,如「GLM-5.3 新一代旗舰模型上线」)。 */
  description: string
  /** 块内首个模型文档链接(相对路径已归一为绝对);无链接 → null。 */
  docUrl: string | null
}

/** '2026-8-19' / '2026-06-16' → '2026-08-19' / '2026-06-16';非法 → null。 */
export function normalizeZhipuDate(raw: string): string | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw.trim())
  if (!m) return null
  const [, y, mo, d] = m
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)))
  if (date.getUTCMonth() !== Number(mo) - 1 || date.getUTCDate() !== Number(d)) return null
  return `${y}-${mo!.padStart(2, '0')}-${d!.padStart(2, '0')}`
}

/** 智谱新品发布 Markdown → 更新块数组。结构化 `<Update>` 块逐个提取 label/description/块内首个链接;
 *  双 lookahead 锚定两属性、**次序无关**(上游调整属性序不致静默清零);畸形块跳过。 */
export function parseZhipuReleases(md: string): ZhipuUpdate[] {
  const out: ZhipuUpdate[] = []
  const blockRe = /<Update\b(?=[^>]*label="([^"]*)")(?=[^>]*description="([^"]*)")[^>]*>([\s\S]*?)<\/Update>/g
  for (const m of md.matchAll(blockRe)) {
    const date = normalizeZhipuDate(m[1]!)
    if (!date) continue
    // 块内首个 markdown 链接([**名称**](路径));相对路径(/cn/…)归一到 docs.bigmodel.cn
    const link = /\[[^\]]*\]\(([^)\s]+)\)/.exec(m[3]!)?.[1]
    const docUrl = link
      ? link.startsWith('/')
        ? `https://docs.bigmodel.cn${link}`
        : link
      : null
    out.push({ date, description: m[2]!, docUrl })
  }
  return out
}

/** 人工核验基线模型(代码即配置;profile 字段部署时幂等刷新,事件不动)。 */
export interface BaselineModel {
  provider: ModelProviderId
  officialId: string
  name: string
  kind: ModelKind
  stage: ReleaseStage
  availability: AvailabilityMode[]
  summary: string | null
  sources: Array<{ title: string; url: string }>
  /** 官方定价;未核验到现价 → null。 */
  pricing: ModelPricing | null
  /** 官方限额(上下文/最大输出/输入大小等);未披露 → null。 */
  limits: ModelLimit[] | null
  /** 官方披露的训练参数量原文;未披露 → null。 */
  trainingParams: string | null
  /**
   * 发布页块的归属判定(双条件,防上游张冠李戴——实测 GLM-Image 块误链 glm-4.7 文档页):
   * 描述含 alias 之一(词边界匹配,「GLM-4.7」不认领「GLM-4.7-Flash」的块)**且** 块内
   * 链接路径含 slug 之一(路径尾边界,「…/glm-4」不认领「…/glm-4-long」)。链接缺失 → 跳过。
   */
  matchAliases: string[]
  matchSlugs: string[]
  /** 人工核验的历史动态(官方发布页/弃用表口径);幂等入库,同键自动解析 'updated' 事件被其取代。 */
  events?: Array<Omit<ModelEvent, 'id'>>
}

export { ZHIPU_BASELINE }

/** alias 词边界命中:前后不得是 [A-Za-z0-9_.-](「GLM-4.7」≠「GLM-4.7-FlashX」;中文不算边界内字符)。 */
function aliasIn(alias: string, description: string): boolean {
  const re = new RegExp(`(?<![\\w.-])${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w.-])`)
  return re.test(description)
}

/** slug 路径命中且尾部带边界(「…/glm-4」不认领「…/glm-4-long」)。 */
function slugIn(slug: string, docUrl: string): boolean {
  const re = new RegExp(`${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`)
  return re.test(docUrl)
}

/**
 * 更新块 → (基线模型 officialId, 事件)。仅双条件匹配的块产事件,kind 恒 'updated'
 * (自动解析不猜语义化事件类型;api_available 等语义类型只出自人工核验基线 events)。
 * 与基线事件同 (模型,日期,信源) 的块由 pollZhipu 跳过,不产重复动态。
 */
export function matchZhipuEvent(u: ZhipuUpdate): { officialId: string; event: Omit<ModelEvent, 'id'> } | null {
  const docUrl = u.docUrl
  if (docUrl === null) return null // 无链接无法核验归属 → 待核验线索,不生成动态
  for (const b of ZHIPU_BASELINE) {
    const aliasHit = b.matchAliases.some((a) => aliasIn(a, u.description))
    const slugHit = b.matchSlugs.some((s) => slugIn(s, docUrl))
    if (aliasHit && slugHit) {
      const event: Omit<ModelEvent, 'id'> = {
        kind: 'updated',
        occurredOn: u.date,
        title: u.description,
        sourceUrl: docUrl,
      }
      return { officialId: b.officialId, event }
    }
  }
  return null
}

// ---- 服务(档案读写 + 轮询;IO 经 ModelTrackingDeps 注入,测试零真网)----

export interface ModelTrackingDeps {
  fetchText: (url: string, timeoutMs: number) => Promise<string>
}

/** 智谱新品发布页(主发布源,研究 §3)。 */
const ZHIPU_RELEASES_URL = 'https://docs.bigmodel.cn/cn/update/new-releases.md'

const nowIso = () => new Date().toISOString()

export class ModelTrackingService {
  constructor(
    private readonly db: Db,
    private readonly deps: ModelTrackingDeps,
  ) {}

  /**
   * 启动初始化:基线幂等 upsert(profile 字段以代码为准刷新,含定价/限额/参数量)+
   * 基线事件入库(同键既有的自动解析 'updated' 事件被人工核验语义取代——同一公告
   * 不留两条动态;issues/01 时期入库的旧 'updated' 行由此清理)+ 首轮取数(不阻塞
   * 启动,失败照陈旧口径降级——基线数据已在库,tile 即有内容)。
   */
  async init(): Promise<void> {
    for (const b of ZHIPU_BASELINE) {
      const { id: modelId } = await this.db
        .insertInto('model_archive')
        .values({
          provider: b.provider,
          official_id: b.officialId,
          name: b.name,
          kind: b.kind,
          stage: b.stage,
          availability: JSON.stringify(b.availability),
          summary: b.summary,
          sources: JSON.stringify(b.sources),
          pricing: b.pricing === null ? null : JSON.stringify(b.pricing),
          limits: b.limits === null ? null : JSON.stringify(b.limits),
          training_params: b.trainingParams,
          created_at: nowIso(),
          updated_at: nowIso(),
        })
        .onConflict((oc) =>
          oc.columns(['provider', 'official_id']).doUpdateSet({
            name: b.name,
            kind: b.kind,
            stage: b.stage,
            availability: JSON.stringify(b.availability),
            summary: b.summary,
            sources: JSON.stringify(b.sources),
            pricing: b.pricing === null ? null : JSON.stringify(b.pricing),
            limits: b.limits === null ? null : JSON.stringify(b.limits),
            training_params: b.trainingParams,
            updated_at: nowIso(),
          }),
        )
        .returning('id')
        .executeTakeFirstOrThrow()
      for (const ev of b.events ?? []) {
        // 同 (模型,日期,信源) 的自动解析 'updated' 事件 → 删(被本条语义化事件取代)
        await this.db
          .deleteFrom('model_events')
          .where('model_id', '=', modelId)
          .where('kind', '=', 'updated')
          .where('occurred_on', '=', ev.occurredOn)
          .where('source_url', '=', ev.sourceUrl)
          .execute()
        await this.db
          .insertInto('model_events')
          .values({
            model_id: modelId,
            kind: ev.kind,
            occurred_on: ev.occurredOn,
            title: ev.title,
            source_url: ev.sourceUrl,
            created_at: nowIso(),
          })
          .onConflict((oc) =>
            oc
              .columns(['model_id', 'kind', 'occurred_on', 'source_url'])
              .doNothing(),
          )
          .execute()
      }
    }
    this.pollQuietly()
  }

  /** 档案读侧(路由直调):模型(可用在前、retired 沉底)+ 各事件倒序 + 信源状态。 */
  async archive(): Promise<ModelArchiveResponse> {
    const models = await this.db
      .selectFrom('model_archive')
      .selectAll()
      .orderBy((eb) => eb.case().when('stage', '=', 'retired').then(1).else(0).end(), 'asc')
      .orderBy('id', 'asc')
      .execute()
    const events = await this.db
      .selectFrom('model_events')
      .selectAll()
      .orderBy('occurred_on', 'desc')
      .orderBy('id', 'desc')
      .execute()
    const byModel = new Map<number, ModelEvent[]>()
    for (const e of events) {
      const list = byModel.get(e.model_id) ?? []
      list.push({
        id: e.id,
        kind: e.kind as ModelEventKind,
        occurredOn: e.occurred_on,
        title: e.title,
        sourceUrl: e.source_url,
      })
      byModel.set(e.model_id, list)
    }
    const sources = await this.db.selectFrom('model_fetch_status').selectAll().execute()
    return {
      models: models.map((r) => ({
        id: r.id,
        provider: r.provider as ModelProviderId,
        officialId: r.official_id,
        name: r.name,
        kind: r.kind as ModelKind,
        stage: r.stage as ReleaseStage,
        availability: JSON.parse(r.availability) as AvailabilityMode[],
        summary: r.summary ?? null,
        sources: JSON.parse(r.sources) as TrackedModel['sources'],
        pricing: r.pricing === null ? null : (JSON.parse(r.pricing) as TrackedModel['pricing']),
        limits: r.limits === null ? null : (JSON.parse(r.limits) as TrackedModel['limits']),
        trainingParams: r.training_params ?? null,
        events: byModel.get(r.id) ?? [],
      })),
      sources: sources.map((s) => ({
        provider: s.provider as ModelProviderId,
        stale: s.stale === 1,
        lastSuccessAt: s.last_success_at ?? null,
      })),
    }
  }

  /** cron 入口:失败只记日志(6h 节奏即天然重试,禁密集重试,同 videoUpdates 口径)。 */
  pollQuietly(): void {
    void this.pollZhipu().catch((e) => console.error('模型追踪(智谱)取数失败:', e))
  }

  /**
   * 智谱一轮:发布页 → 匹配基线 → 事件幂等入库(去重键 = UNIQUE(model_id,kind,
   * occurred_on,source_url),研究 §6.6)→ 信源标记成功。已有**任意类型**事件占住同
   * (模型,日期,信源) 的公告跳过——人工核验基线事件(api_available 等)在库时,自动
   * 解析不再为同一公告补 'updated' 重复行。失败口径覆盖两类:fetch 抛错,与「取到 200
   * 但一个结构化块都解析不出」——后者即上游改版(确定性解析的主要失效面),同样标记
   * 陈旧、保留库内最后成功结果,不静默清零。
   */
  async pollZhipu(): Promise<void> {
    try {
      const md = await this.deps.fetchText(ZHIPU_RELEASES_URL, 30_000)
      const updates = parseZhipuReleases(md)
      if (updates.length === 0) throw new Error('发布页无结构化更新块(疑似上游改版)')
      const archive = await this.db
        .selectFrom('model_archive')
        .select(['id', 'official_id'])
        .where('provider', '=', 'zhipu')
        .execute()
      const idOf = new Map(archive.map((r) => [r.official_id, r.id]))
      // 已入库公告键(模型+日期+信源,类型无关)——基线事件已覆盖的不再自动入库
      const existing = await this.db
        .selectFrom('model_events')
        .select(['model_id', 'occurred_on', 'source_url'])
        .execute()
      const seen = new Set(existing.map((e) => `${e.model_id}|${e.occurred_on}|${e.source_url}`))
      for (const u of updates) {
        const hit = matchZhipuEvent(u)
        if (!hit) continue
        const modelId = idOf.get(hit.officialId)
        if (modelId === undefined) continue
        if (seen.has(`${modelId}|${hit.event.occurredOn}|${hit.event.sourceUrl}`)) continue
        await this.db
          .insertInto('model_events')
          .values({
            model_id: modelId,
            kind: hit.event.kind,
            occurred_on: hit.event.occurredOn,
            title: hit.event.title,
            source_url: hit.event.sourceUrl,
            created_at: nowIso(),
          })
          .onConflict((oc) =>
            oc
              .columns(['model_id', 'kind', 'occurred_on', 'source_url'])
              .doNothing(),
          )
          .execute()
      }
      await this.markSource('zhipu', true)
    } catch (e) {
      // markSource 自身失败不吞原始错误(极端:DB 写挂,原始信源错误更值得上抛/记日志)
      await this.markSource('zhipu', false).catch(() => {})
      throw e
    }
  }

  private async markSource(provider: ModelProviderId, ok: boolean): Promise<void> {
    const now = nowIso()
    await this.db
      .insertInto('model_fetch_status')
      .values({
        provider,
        stale: ok ? 0 : 1,
        last_success_at: ok ? now : null,
        last_attempt_at: now,
      })
      .onConflict((oc) =>
        oc.column('provider').doUpdateSet({
          stale: ok ? 0 : 1,
          ...(ok ? { last_success_at: now } : {}),
          last_attempt_at: now,
        }),
      )
      .execute()
  }
}

// ---- HTTP 路由 ----

export function modelTrackingRoutes(service: ModelTrackingService): Hono<AuthEnv> {
  return new Hono<AuthEnv>().get('/api/model-tracking/archive', async (c) =>
    c.json(await service.archive()),
  )
}

// ---- 生产协作器(同 prodVideoDeps 范式:测试注入假 deps,生产装配显式)----

export function prodModelDeps(): ModelTrackingDeps {
  return { fetchText }
}

// ---- 定时轮询(研究 §6:6h 节奏;非整点错开,同 videoUpdates 口径)----

export function startModelTrackingScheduler(service: ModelTrackingService): void {
  schedule('41 */6 * * *', () => service.pollQuietly())
}
