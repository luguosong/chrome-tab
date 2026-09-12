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
  ModelTrainingParams,
  ReleaseStage,
  TrackedModel,
} from 'chrome-tab-shared'
import { fetchText } from './common'
import type { Db } from './db'
import type { AuthEnv } from './auth'
import seed from './modelBaselineSeed.json'
import { DEEPSEEK_DEF } from './providers/deepseek'
import { ZHIPU_DEF } from './providers/zhipu'
import { ANTHROPIC_DEF } from './providers/anthropic'
import { XAI_DEF } from './providers/xai'
import { MOONSHOT_DEF } from './providers/moonshot'
import { OPENAI_DEF } from './providers/openai'
import { ALIBABA_DEF } from './providers/alibaba'
import type { BaselineRow, MatchedHit, PendingClue, ProviderDef } from './providers/def'
import {
  AA_EVALUATOR,
  AA_EVALUATOR_LABEL,
  AA_LLM_URL,
  AA_MEDIA_ENDPOINTS,
  aaAutoMappings,
  aaMappingIndex,
  aaRowsFromLlms,
  aaRowsFromMedia,
  beijingToday,
  type AaBaselineRef,
  type AaEvalRow,
  type AaMappingRow,
} from './aaEvaluations'
import { verifyClue } from './modelVerify'
import { makeClueLedger, type ClueLedger } from './clueLedger'

/**
 * 模型追踪(CONTEXT.md「模型追踪/跟踪模型/模型档案」;ADR-0025):全局单例图标的
 * 后端档案。与「AI 热点」的易失代理相反、与「视频更新」同为持久化轮询,但**无
 * user_id**——档案对所有用户共享,单个信源失败保留最后成功结果并标记陈旧
 * (model_fetch_status,按厂家隔离)。三段分工(研究 §6):**档案行(基本资料)只来自
 * 代码内人工核验基线**,部署即幂等 upsert 刷新;**模型动态来自各厂家主发布源确定性
 * 解析**(智谱新品发布 Markdown 的 `<Update label description>` 块、Anthropic
 * release notes 的 `### 日期` 段内条目、xAI 发布流的 `## 月份`/`### 条目` 段——仅月
 * 份粒度、事件锚定当月 1 日、月之暗面资讯/Blog 的文章卡片(无 RSS,按文章 URL
 * 去重)、DeepSeek API Change Log 的 HTML `Date:` 段内 h3 小节、OpenAI API changelog
 * 的 `## 月份`/`### 日` 段内类型行(`Model:` 字段即结构化归属)、阿里通义百炼
 * 「模型上下架与更新」首表的表格行(模型ID 结构化列;各家的解析器/匹配器/线索
 * 策略随厂家 provider 文件走,ADR-0038);按模型+类型+日期+信源去重);解析器
 * **不认识**的更新块(基线外型号,含智谱平台托管的第三方模型、Anthropic 仅限受邀
 * 项目的 Mythos 系列)只作待核验线索跳过——待基线人工核验后纳入,这是「跟踪厂家」
 * 的定义性约束(不开放任意厂家/信源配置,理由见 ADR-0025)。issues/08 增外部评测:
 * Artificial Analysis 六路端点每日快照(slug 精确映射,见 aaEvaluations.ts),分数
 * 漂移不产动态、首次进入评测产 evaluated,评测源失败与厂家信源互不影响。
 */

/** 人工核验基线模型(ADR-0058 起形态不变、真相源变:种子文件快照 + model_archive 表)。 */
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
  /** 官方披露的训练参数量(MoE 总/激活分别记录);未披露 → null。 */
  trainingParams: ModelTrainingParams | null
  /**
   * 发布页块的归属判定:alias 词边界匹配是共用底座(「GLM-4.7」不认领「GLM-4.7-Flash」
   * 的块)。智谱/Anthropic 再加链接 slug 双条件(防上游张冠李戴——实测 GLM-Image 块误链
   * glm-4.7 文档页);xAI 只用标题 alias(条目标题即官方条目名,见 matchXaiEvent);
   * OpenAI 用 changelog 类型行的 `Model:` 字段精确/最长前缀匹配(结构化 ID),无需词边界。
   */
  matchAliases: string[]
  /** 智谱/Anthropic 双条件的链接半边(路径尾边界,「…/glm-4」不认领「…/glm-4-long」);xAI 行省略。 */
  matchSlugs?: string[]
  /** 人工核验的历史动态(官方发布页/弃用表口径);仅空库首启灌入,此后事件只增不改。 */
  events?: Array<Omit<ModelEvent, 'id'>>
}

/** 种子快照(2026-09-05 由七个代码基线 + AA_MODEL_MAP 一次性生成;空库首启用,此后不再更新)。 */
const SEED = seed as {
  models: BaselineModel[]
  aaMapping: Array<{ slug: string; provider: ModelProviderId; officialId: string }>
}

/**
 * 全部跟踪厂家的 provider 定义(取数差异面,ADR-0038):pollProvider 轮询入口的
 * 遍历/查表源。**Record 满配 = 编译期完备性**——新厂家票在 shared 的
 * ModelProviderId 扩了枚举而漏挂此处,编译即报错;顺序与 cron 日志习惯一致。
 */
const PROVIDERS: Record<ModelProviderId, ProviderDef<unknown>> = {
  zhipu: ZHIPU_DEF,
  anthropic: ANTHROPIC_DEF,
  xai: XAI_DEF,
  moonshot: MOONSHOT_DEF,
  openai: OPENAI_DEF,
  deepseek: DEEPSEEK_DEF,
  alibaba: ALIBABA_DEF,
}

/** 公告去重键(模型+日期+信源;init 取代删除与 poll 跳过共用,防两处拼串漂移)。 */
const eventKey = (modelId: number, occurredOn: string, sourceUrl: string) =>
  `${modelId}|${occurredOn}|${sourceUrl}`

// ---- 服务(档案读写 + 轮询;IO 经 ModelTrackingDeps 注入,测试零真网)----

/** 一轮解析产物:认领事件 + 待核验线索(类型 PendingClue 来自 providers/def.ts;月暗文章流等无线索信源 clues 恒空)。 */
export interface ParsedFeed {
  hits: Array<{ officialId: string; event: Omit<ModelEvent, 'id'> }>
  clues: PendingClue[]
}

export interface ModelTrackingDeps {
  /** init 可选透传(AA 评测 x-api-key header;生产 fetchText 原生支持,测试桩忽略)。 */
  fetchText: (url: string, timeoutMs: number, init?: RequestInit) => Promise<string>
  /** auto 核验(LLM 网关 Key/候选链)的环境(ADR-0058);缺省 process.env,测试注入。 */
  env?: NodeJS.ProcessEnv
  /** LLM 单次调用注入(auto 核验测试零真网);缺省真 callModel(ADR-0037 闸门在其内部)。 */
  callModel?: (model: string, apiKey: string, system: string, user: string) => Promise<{ content: string | null; resp: string }>
}

const nowIso = () => new Date().toISOString()

export class ModelTrackingService {
  /** 线索账本(票 .scratch/线索账本/01):model_pending_clues 域行为的单点(入库/核验结果/活动窗)。 */
  private readonly ledger: ClueLedger

  constructor(
    private readonly db: Db,
    private readonly deps: ModelTrackingDeps,
    /** Artificial Analysis API Key(issues/08);空串 = 未配置:评测轮询整体跳过,读侧 configured=false。 */
    private readonly aaApiKey = '',
  ) {
    this.ledger = makeClueLedger(db)
  }

  /** deps 注入 env 或进程 env(auto 核验用)。 */
  private get env(): NodeJS.ProcessEnv {
    return this.deps.env ?? process.env
  }

  /**
   * 启动初始化(ADR-0058):种子 bootstrap(空库全量灌、存量库回填归属列)取代原
   * 「代码基线每启幂等 upsert」——profile 字段此后以 DB 为准,人工修订/auto 入库
   * 不再被部署刷新。首轮取数照旧不阻塞启动。
   */
  async init(): Promise<void> {
    await this.bootstrapFromSeed()
    void this.pollProvider()
  }

  /** 空库灌种子(行+事件);存量库(迁移前列全默认)按种子回填 aliases/slugs。幂等。 */
  private async bootstrapFromSeed(): Promise<void> {
    // 旧 aaUnmappedClues 的存量线索(键 aa: 前缀)语义已死(2026-09-05 翻转为自动映射
    // 不再产出),不清会被 verifyPendingClues 误核验——AA 模型页被当厂家一手信源。
    // 一次性迁移清残留原地、不走「线索账本」(票 01 裁决 7:不为一次性调用 widening interface)
    await this.db.deleteFrom('model_pending_clues').where('model_key', 'like', 'aa:%').execute()
    const existing = await this.db
      .selectFrom('model_archive')
      .select(['provider', 'official_id', 'match_aliases'])
      .execute()
    if (existing.length === 0) {
      // 单事务灌入(code-review:中途崩的重启会因「已有行」跳过灌入,半灌态永久化)。
      // 事件入库同事务:同 (模型,日期,信源) 的 'updated' 先删(语义化事件取代)。
      await this.db.transaction().execute(async (trx) => {
        for (const b of SEED.models) {
          const { id: modelId } = await trx
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
              training_params: b.trainingParams === null ? null : JSON.stringify(b.trainingParams),
              match_aliases: JSON.stringify(b.matchAliases),
              match_slugs: JSON.stringify(b.matchSlugs ?? []),
              verified: 'manual',
              created_at: nowIso(),
              updated_at: nowIso(),
            })
            .onConflict((oc) => oc.columns(['provider', 'official_id']).doNothing())
            .returning('id')
            .executeTakeFirstOrThrow()
          for (const ev of b.events ?? []) {
            await trx
              .deleteFrom('model_events')
              .where('model_id', '=', modelId)
              .where('kind', '=', 'updated')
              .where('occurred_on', '=', ev.occurredOn)
              .where('source_url', '=', ev.sourceUrl)
              .execute()
            await trx
              .insertInto('model_events')
              .values({
                model_id: modelId,
                kind: ev.kind,
                occurred_on: ev.occurredOn,
                title: ev.title,
                source_url: ev.sourceUrl,
                created_at: nowIso(),
              })
              .onConflict((oc) => oc.columns(['model_id', 'kind', 'occurred_on', 'source_url']).doNothing())
              .execute()
          }
        }
      })
    } else if (existing.every((r) => r.match_aliases === '[]')) {
      // ADR-0058 迁移:存量行(代码基线时代的档案镜像)按种子回填归属判定列;
      // DB 独有行(理论上无——此分支只在迁移首启走到)留默认不炸。
      const byKey = new Map(SEED.models.map((b) => [`${b.provider}|${b.officialId}`, b]))
      for (const r of existing) {
        const b = byKey.get(`${r.provider}|${r.official_id}`)
        if (b === undefined) continue
        await this.db
          .updateTable('model_archive')
          .set({
            match_aliases: JSON.stringify(b.matchAliases),
            match_slugs: JSON.stringify(b.matchSlugs ?? []),
          })
          .where('provider', '=', r.provider)
          .where('official_id', '=', r.official_id)
          .execute()
      }
    }
    const aaExisting = await this.db.selectFrom('model_aa_mapping').select('slug').execute()
    if (aaExisting.length === 0) {
      for (const m of SEED.aaMapping) {
        await this.db
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

  /** 种子/auto 行入库共用:insert 行(verified 区分);冲突(已存在)静默跳过——修订不覆盖。 */
  private async upsertBaselineRow(
    b: Pick<BaselineModel, 'provider' | 'officialId' | 'name' | 'kind' | 'stage' | 'availability' | 'summary' | 'sources' | 'pricing' | 'limits' | 'trainingParams'> & { matchAliases: string[]; matchSlugs?: string[]; verified?: 'manual' | 'auto' },
    db: Pick<Db, 'insertInto'> = this.db,
  ): Promise<void> {
    await db
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
        training_params: b.trainingParams === null ? null : JSON.stringify(b.trainingParams),
        match_aliases: JSON.stringify(b.matchAliases),
        match_slugs: JSON.stringify(b.matchSlugs ?? []),
        verified: b.verified ?? 'manual',
        created_at: nowIso(),
        updated_at: nowIso(),
      })
      .onConflict((oc) => oc.columns(['provider', 'official_id']).doNothing())
      .execute()
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
    // 评测快照行(issues/08):按模型聚合;状态行与厂家信源状态隔离(model_evaluation_status)
    const evalRows = await this.db
      .selectFrom('model_evaluations')
      .selectAll()
      .where('evaluator', '=', AA_EVALUATOR)
      .execute()
    const evalsByModel = new Map<number, TrackedModel['evaluations']>()
    for (const r of evalRows) {
      const list = evalsByModel.get(r.model_id) ?? []
      list.push({
        evaluator: AA_EVALUATOR_LABEL,
        benchmark: r.benchmark,
        score: r.score,
        version: r.version,
        date: r.snapshot_date,
        url: r.url,
      })
      evalsByModel.set(r.model_id, list)
    }
    const evalStatus = await this.db
      .selectFrom('model_evaluation_status')
      .selectAll()
      .where('evaluator', '=', AA_EVALUATOR)
      .executeTakeFirst()
    // 线索读侧经「线索账本」(徽标窗 × 触人集,ADR-0058 注记 2026-09-10 轴对齐——
    // 窗口与集合策略单点于 clueLedger.ts);此处只做 wire 投影(date/url)
    const clues = await this.ledger.visibleClues()
    return {
      pendingClues: clues.map((c) => ({
        provider: c.provider,
        date: c.occurredOn,
        title: c.title,
        url: c.sourceUrl,
      })),
      models: models.map((r) => ({
        id: r.id,
        provider: r.provider as ModelProviderId,
        officialId: r.official_id,
        name: r.name,
        kind: r.kind as ModelKind,
        stage: r.stage as ReleaseStage,
        verified: r.verified === 'auto' ? 'auto' : 'manual',
        availability: JSON.parse(r.availability) as AvailabilityMode[],
        summary: r.summary ?? null,
        sources: JSON.parse(r.sources) as TrackedModel['sources'],
        pricing: r.pricing === null ? null : (JSON.parse(r.pricing) as TrackedModel['pricing']),
        limits: r.limits === null ? null : (JSON.parse(r.limits) as TrackedModel['limits']),
        trainingParams: r.training_params === null ? null : (JSON.parse(r.training_params) as TrackedModel['trainingParams']),
        evaluations: evalsByModel.get(r.id) ?? [],
        events: byModel.get(r.id) ?? [],
      })),
      sources: sources.map((s) => ({
        provider: s.provider as ModelProviderId,
        stale: s.stale === 1,
        lastSuccessAt: s.last_success_at ?? null,
      })),
      evaluations: {
        configured: this.aaApiKey !== '',
        stale: evalStatus === undefined ? false : evalStatus.stale === 1,
        lastSuccessAt: evalStatus?.last_success_at ?? null,
      },
    }
  }

  /**
   * 取数轮询唯一入口(ADR-0041,吸收原 pollQuietly 与 7 个 pollXxx 薄壳):生产
   * cron/init 与测试同一 seam。省缺 id = 全部厂家 + 评测,**各家独立 catch**——
   * 单家失败记日志、标陈旧,不牵连他家(ADR-0058 起 2h 节奏即天然重试,禁密集重试,同
   * videoUpdates 口径);全轮落定后 resolve(可等待),不抛。指定 id = 单家一轮,
   * 失败直抛——确定性单轮,测试断言标陈旧的入口。
   */
  async pollProvider(id?: ModelProviderId): Promise<void> {
    if (id !== undefined) {
      await this.runPoll(PROVIDERS[id])
      return
    }
    const jobs = Object.values(PROVIDERS).map((def) =>
      this.runPoll(def).catch((e) => console.error(`模型追踪(${def.label})取数失败:`, e)),
    )
    jobs.push(
      this.pollEvaluations().catch((e) => console.error('模型追踪(评测)取数失败:', e)),
    )
    await Promise.all(jobs)
  }

  /**
   * 一轮厂家取数的统一巡走(ADR-0038):逐信源页 fetch→解析→零条目判改版→逐条目
   * 分派(命中/线索)→入库→标新鲜;**任一页失败先吞后聚,循环后统一补压终态(失败
   * 优先)再上抛首个错误**——后一页的成功不会覆盖前一页的失败标记,单页家(urls 仅
   * 一项)自然退化为同语义(失败时多一次幂等 markSource,已记档的可接受漂移)。
   * 逐厂家的差异(信源/解析/匹配/线索)全部在 ProviderDef,此处不出现厂家分支。
   */
  private async runPoll(def: ProviderDef<unknown>): Promise<void> {
    const errs: unknown[] = []
    const rows = await this.baselineRows(def.id)
    for (const url of def.urls) {
      try {
        await this.pollOne(def.id, url, (md) => {
          const { entries, skipped } = def.parse(md)
          // 意外跳过先于判改版 warn:全灭场景的 skipped 片段就是「上游变成了什么」的排障线索。
          // 日志只打前 5 条片段:一个畸形月标题可让其后百余条类型行全部落 skipped,
          // 全量打会冲刷日志通道(评审修正);数组本身保持全量供测试断言。
          if (skipped.length > 0) {
            console.warn(
              `模型追踪(${def.label})意外跳过 ${skipped.length} 条:`,
              skipped.length > 5 ? [...skipped.slice(0, 5), `…另 ${skipped.length - 5} 条`] : skipped,
            )
          }
          if (entries.length === 0) return null
          const hits: MatchedHit[] = []
          const clues: PendingClue[] = []
          for (const e of entries) {
            const r = def.matchEntry(e, rows)
            hits.push(...r.hits)
            clues.push(...r.clues)
          }
          return { hits, clues }
        })
      } catch (e) {
        errs.push(e)
      }
    }
    // auto 核验(ADR-0058):窗口内未核验线索逐条 LLM 核验。取数失败也跑(旧线索
    // 不该陪葬);自身失败只记日志,不并入取数错误口径。
    await this.verifyPendingClues(def).catch((e) =>
      console.error(`模型追踪(${def.label})auto 核验失败:`, e),
    )
    if (errs.length > 0) {
      await this.markSource(def.id, false).catch(() => {})
      throw errs[0]
    }
  }

  /** 该家基线行集(每轮从 model_archive 读出;归属判定输入,ADR-0058 与代码常量解绑)。 */
  private async baselineRows(provider: ModelProviderId): Promise<BaselineRow[]> {
    const rows = await this.db
      .selectFrom('model_archive')
      .select(['official_id', 'match_aliases', 'match_slugs'])
      .where('provider', '=', provider)
      .execute()
    return rows.map((r) => ({
      officialId: r.official_id,
      matchAliases: JSON.parse(r.match_aliases) as string[],
      matchSlugs: JSON.parse(r.match_slugs) as string[],
    }))
  }

  /**
   * 匹配后的事件幂等入库(两家 poll 共用):去重键 = UNIQUE(model_id,kind,occurred_on,
   * source_url),研究 §6.6。已有**任意类型**事件占住同 (模型,日期,信源) 的公告跳过
   * ——人工核验基线事件(api_available 等)在库时,自动解析不再为同一公告补 'updated'
   * 重复行。
   */
  private async ingest(
    provider: ModelProviderId,
    hits: Array<{ officialId: string; event: Omit<ModelEvent, 'id'> }>,
  ): Promise<void> {
    const archive = await this.db
      .selectFrom('model_archive')
      .select(['id', 'official_id'])
      .where('provider', '=', provider)
      .execute()
    const idOf = new Map(archive.map((r) => [r.official_id, r.id]))
    // 已入库公告键(模型+日期+信源,类型无关)——基线事件已覆盖的不再自动入库
    const existing = await this.db
      .selectFrom('model_events')
      .select(['model_id', 'occurred_on', 'source_url'])
      .execute()
    const seen = new Set(existing.map((e) => eventKey(e.model_id, e.occurred_on, e.source_url)))
    for (const hit of hits) {
      const modelId = idOf.get(hit.officialId)
      if (modelId === undefined) continue
      if (seen.has(eventKey(modelId, hit.event.occurredOn, hit.event.sourceUrl))) continue
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
  }

  /**
   * 一轮取数的公共失败口径(fetch 抛错与「200 但零结构化条目」= 上游改版,均抛错标
   * 陈旧、保留库内最后成功结果,不静默清零;markSource 自身失败不吞原始错误——极端:
   * DB 写挂,原始信源错误更值得上抛/记日志)。结构差异(解析器/匹配器/线索提取)由
   * ProviderDef 闭合(runPoll 组装),返回 null 即「解析不出任何结构化条目」。
   */
  private async pollOne(
    provider: ModelProviderId,
    url: string,
    parseAndMatch: (md: string) => ParsedFeed | null,
  ): Promise<void> {
    try {
      const md = await this.deps.fetchText(url, 30_000)
      const feed = parseAndMatch(md)
      if (feed === null) throw new Error('发布源无结构化条目(疑似上游改版)')
      await this.ingest(provider, feed.hits)
      await this.ledger.ingest(provider, feed.clues)
      await this.markSource(provider, true)
    } catch (e) {
      await this.markSource(provider, false).catch(() => {})
      throw e
    }
  }

  /**
   * auto 核验一轮(ADR-0058):核验窗重试集逐条(「线索账本」dueClues——含 error
   * 下轮重试,spec 1.2)——①噪音谓词(def.noiseClue)硬拦 →
   * noise(确定性已知噪音,不触人:百炼托管常态,徽标也不占);②verifyClue(LLM)四态:
   * accept 入档(verified='auto',aliases=草稿)+ 当轮产 kind 'updated' 事件
   * (occurredOn/标题/信源用线索——语义保守,api_available 留给人工修订);
   * reject(噪音/低置信)→ rejected 留表触人;insufficient(判自家但草稿校验不过,
   * spec 1.5)→ 活动窗内触人但不重试(一次定终身,超窗淡出);error → 落表
   * 不触人,按 2h 轮询在活动窗内重试。reject/insufficient/error 均落
   * verify_reason(误拒可归因,spec 1.4)。触达 = 图标徽标「N 待核验」(ADR-0058
   * 注记:ntfy 推送通道 2026-09-06 撤除)。行插入 onConflict doNothing:已存在
   * (人工先收录)时静默,线索停更滚出自愈。
   */
  private async verifyPendingClues(def: ProviderDef<unknown>): Promise<void> {
    for (const clue of await this.ledger.dueClues(def.id)) {
      if (def.noiseClue?.(clue) === true) {
        await this.ledger.recordVerification(def.id, clue.modelKey, 'noise')
        continue
      }
      const r = await verifyClue(def, clue, this.deps.fetchText, this.env, this.deps.callModel)
      if (r.outcome === 'error') {
        console.warn(`模型追踪(${def.label})线索核验失败(下轮重试) ${clue.modelKey}:`, r.reason)
        await this.ledger.recordVerification(def.id, clue.modelKey, 'error', r.reason)
        continue
      }
      if (r.outcome === 'reject') {
        await this.ledger.recordVerification(def.id, clue.modelKey, 'rejected', r.reason)
        continue
      }
      if (r.outcome === 'insufficient') {
        await this.ledger.recordVerification(def.id, clue.modelKey, 'insufficient', r.reason)
        continue
      }
      await this.db.transaction().execute(async (trx) => {
        if (!(await makeClueLedger(trx).recordVerification(def.id, clue.modelKey, 'accepted'))) return
        await this.upsertBaselineRow({
          provider: def.id,
          officialId: r.draft.officialId,
          name: r.draft.name,
          kind: r.draft.kind as ModelKind,
          stage: r.draft.stage as ReleaseStage,
          availability: r.draft.availability as AvailabilityMode[],
          summary: r.draft.summary,
          sources: r.draft.sources,
          pricing: r.draft.pricing as ModelPricing | null,
          limits: r.draft.limits as ModelLimit[] | null,
          trainingParams: null,
          matchAliases: r.draft.matchAliases,
          verified: 'auto',
        }, trx)
        const modelId = (await trx
          .selectFrom('model_archive')
          .select('id')
          .where('provider', '=', def.id)
          .where('official_id', '=', r.draft.officialId)
          .executeTakeFirstOrThrow())!.id
        await trx
          .insertInto('model_events')
          .values({
            model_id: modelId,
            kind: 'updated',
            occurred_on: clue.occurredOn,
            title: clue.title,
            source_url: clue.sourceUrl,
            created_at: nowIso(),
          })
          .onConflict((oc) => oc.columns(['model_id', 'kind', 'occurred_on', 'source_url']).doNothing())
          .execute()
      })
    }
  }

  /**
   * 评测一轮(issues/08):LLM 主表 + 五个媒体榜单六路取数(单 Key 限额 1000/日,ADR-0058 起
   * 2h 节奏 ×6 路 ≈ 72 请求/日,远低于限额;结果落库即缓存,满足 API 缓存要求)。任一路
   * 失败 → 整轮按评测源失败处理:保留最后成功快照、只标评测陈旧,不影响任何厂家档案。
   * 未配置 Key 时整体 no-op(不取数、不写状态)。分数漂移只更新快照行(不产动态);
   * 唯产动态的口径 = 运行期模型首次获得评测行(kind 'evaluated',首配接入整轮静默;
   * Benchmark 方法/版本变化免费 API 不暴露、不可检测,为已知上限)。
   */
  async pollEvaluations(): Promise<void> {
    if (this.aaApiKey === '') return
    try {
      const headers = { 'x-api-key': this.aaApiKey }
      const llmJson = await this.deps.fetchText(AA_LLM_URL, 30_000, { headers })
      // 同名自动映射(ADR-0058,formerly aaUnmappedClues 落线索):LLM 主表条目 slug
      // 归一与基线行同名且不在映射表 → 直接 upsert(verified='auto')——媒体端点不参与
      // (无 creator 且 slug 带厂商前缀,同名误配风险)。upsert 失败只记日志不炸评测轮。
      const mappingRows = await this.readAaMappings()
      const archiveRefs = await this.db
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
        await this.db
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
        rows.push(...aaRowsFromMedia(await this.deps.fetchText(ep.url, 30_000, { headers }), ep.benchmark, mapping))
      }
      await this.replaceEvaluationSnapshot(rows)
      await this.markEvalStatus(true)
    } catch (e) {
      await this.markEvalStatus(false).catch(() => {})
      throw e
    }
  }

  /** AA 映射表全量读(model_aa_mapping;pollEvaluations 每轮一次)。 */
  private async readAaMappings(): Promise<AaMappingRow[]> {
    const rows = await this.db
      .selectFrom('model_aa_mapping')
      .select(['slug', 'provider', 'official_id'])
      .execute()
    return rows.map((r) => ({
      slug: r.slug,
      provider: r.provider as ModelProviderId,
      officialId: r.official_id,
    }))
  }

  /** 快照整表替换(单事务:删旧插新 + 运行期首入评测动态;首配接入静默),幂等。 */
  private async replaceEvaluationSnapshot(rows: AaEvalRow[]): Promise<void> {
    const archive = await this.db
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
    const existing = await this.db
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
    await this.db.transaction().execute(async (trx) => {
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

  /** 评测源状态(独立于厂家信源的 model_fetch_status;同 upsert 口径)。 */
  private async markEvalStatus(ok: boolean): Promise<void> {
    const now = nowIso()
    await this.db
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

// ---- 定时轮询(ADR-0058「当天时效」:6h→2h;非整点错开,同 videoUpdates 口径)----

export function startModelTrackingScheduler(service: ModelTrackingService): void {
  schedule('41 */2 * * *', () => void service.pollProvider())
}
