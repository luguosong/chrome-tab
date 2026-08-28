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
import { ZHIPU_BASELINE } from './zhipuBaseline'
import { ANTHROPIC_BASELINE } from './anthropicBaseline'
import { XAI_BASELINE } from './xaiBaseline'
import { KIMI_BASELINE } from './kimiBaseline'
import { OPENAI_BASELINE } from './openaiBaseline'
import { DEEPSEEK_BASELINE } from './deepseekBaseline'
import { QWEN_BASELINE } from './qwenBaseline'
import { DEEPSEEK_DEF } from './providers/deepseek'
import { ZHIPU_DEF } from './providers/zhipu'
import { ANTHROPIC_DEF } from './providers/anthropic'
import { XAI_DEF } from './providers/xai'
import { MOONSHOT_DEF } from './providers/moonshot'
import { OPENAI_DEF } from './providers/openai'
import { ALIBABA_DEF } from './providers/alibaba'
import type { MatchedHit, PendingClue, ProviderDef } from './providers/def'
import {
  AA_EVALUATOR,
  AA_EVALUATOR_LABEL,
  AA_LLM_URL,
  AA_MEDIA_ENDPOINTS,
  aaRowsFromLlms,
  aaRowsFromMedia,
  beijingToday,
  type AaEvalRow,
} from './aaEvaluations'

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
  /** 官方披露的训练参数量(MoE 总/激活分别记录);未披露 → null。 */
  trainingParams: ModelTrainingParams | null
  /**
   * 发布页块的归属判定:alias 词边界匹配是共用底座(「GLM-4.7」不认领「GLM-4.7-Flash」
   * 的块)。智谱/Anthropic 再加链接 slug 双条件(防上游张冠李戴——实测 GLM-Image 块误链
   * glm-4.7 文档页);xAI 只用标题 alias(条目标题即官方条目名,见 matchXaiEvent);
   * OpenAI 用 changelog 类型行的 `Model:` 字段精确/最长前缀匹配(结构化 ID,见
   * resolveOpenAIModelId),无需词边界。
   */
  matchAliases: string[]
  /** 智谱/Anthropic 双条件的链接半边(路径尾边界,「…/glm-4」不认领「…/glm-4-long」);xAI 行省略。 */
  matchSlugs?: string[]
  /** 人工核验的历史动态(官方发布页/弃用表口径);幂等入库,同键自动解析 'updated' 事件被其取代。 */
  events?: Array<Omit<ModelEvent, 'id'>>
}


/** 全部厂家基线(init 幂等 upsert 的单一遍历源;新厂家票 = 基线文件 + 追加于此)。 */
const ALL_BASELINES: BaselineModel[] = [
  ...ZHIPU_BASELINE,
  ...ANTHROPIC_BASELINE,
  ...XAI_BASELINE,
  ...KIMI_BASELINE,
  ...OPENAI_BASELINE,
  ...DEEPSEEK_BASELINE,
  ...QWEN_BASELINE,
]

/**
 * 全部跟踪厂家的 provider 定义(取数差异面,ADR-0038):cron(pollQuietly)与运维单轮
 * (pollXxx 薄壳)的遍历/委托源。**Record 满配 = 编译期完备性**——新厂家票在 shared
 * 的 ModelProviderId 扩了枚举而漏挂此处,编译即报错;顺序与 cron 日志习惯一致。
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
}

const nowIso = () => new Date().toISOString()

export class ModelTrackingService {
  constructor(
    private readonly db: Db,
    private readonly deps: ModelTrackingDeps,
    /** Artificial Analysis API Key(issues/08);空串 = 未配置:评测轮询整体跳过,读侧 configured=false。 */
    private readonly aaApiKey = '',
  ) {}

  /**
   * 启动初始化:基线幂等 upsert(profile 字段以代码为准刷新,含定价/限额/参数量)+
   * 基线事件入库(同键既有的自动解析 'updated' 事件被人工核验语义取代——同一公告
   * 不留两条动态;issues/01 时期入库的旧 'updated' 行由此清理)+ 首轮取数(不阻塞
   * 启动,失败照陈旧口径降级——基线数据已在库,tile 即有内容)。
   */
  async init(): Promise<void> {
    for (const b of ALL_BASELINES) {
      // profile 字段一处定义,insert 与 upsert 更新共用(新增字段只改这里)
      const profile = {
        name: b.name,
        kind: b.kind,
        stage: b.stage,
        availability: JSON.stringify(b.availability),
        summary: b.summary,
        sources: JSON.stringify(b.sources),
        pricing: b.pricing === null ? null : JSON.stringify(b.pricing),
        limits: b.limits === null ? null : JSON.stringify(b.limits),
        training_params: b.trainingParams === null ? null : JSON.stringify(b.trainingParams),
      }
      const { id: modelId } = await this.db
        .insertInto('model_archive')
        .values({
          provider: b.provider,
          official_id: b.officialId,
          ...profile,
          created_at: nowIso(),
          updated_at: nowIso(),
        })
        .onConflict((oc) =>
          oc
            .columns(['provider', 'official_id'])
            .doUpdateSet({ ...profile, updated_at: nowIso() }),
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
    // 线索只读「7 天内仍出现」的(基线收录后条目停写,last_seen_at 停更自然滚出)
    const clueCutoff = new Date(Date.now() - 7 * 86400_000).toISOString()
    const clueRows = await this.db
      .selectFrom('model_pending_clues')
      .selectAll()
      .where('last_seen_at', '>=', clueCutoff)
      .execute()
    return {
      pendingClues: clueRows
        .sort((a, b) => (a.occurred_on < b.occurred_on ? 1 : -1))
        .map((r) => ({
          provider: r.provider as ModelProviderId,
          date: r.occurred_on,
          title: r.title,
          url: r.source_url,
        })),
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

  /** cron 入口:失败只记日志(6h 节奏即天然重试,禁密集重试,同 videoUpdates 口径);
   *  各厂家独立 catch——单家失败不影响另一家本轮取数;评测源同理独立(issues/08)。 */
  pollQuietly(): void {
    for (const def of Object.values(PROVIDERS)) {
      void this.runPoll(def).catch((e) => console.error(`模型追踪(${def.label})取数失败:`, e))
    }
    void this.pollEvaluations().catch((e) => console.error('模型追踪(评测)取数失败:', e))
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
    for (const url of def.urls) {
      try {
        await this.pollOne(def.id, url, (md) => {
          const entries = def.parse(md)
          if (entries.length === 0) return null
          const hits: MatchedHit[] = []
          const clues: PendingClue[] = []
          for (const e of entries) {
            const r = def.matchEntry(e)
            hits.push(...r.hits)
            if (r.clue !== null) clues.push(r.clue)
          }
          return { hits, clues }
        })
      } catch (e) {
        errs.push(e)
      }
    }
    if (errs.length > 0) {
      await this.markSource(def.id, false).catch(() => {})
      throw errs[0]
    }
  }

  /** DeepSeek 一轮(差异面见 providers/deepseek.ts 的 DEEPSEEK_DEF)。 */
  async pollDeepSeek(): Promise<void> {
    await this.runPoll(DEEPSEEK_DEF)
  }

  /** 通义一轮(差异面见 providers/alibaba.ts 的 ALIBABA_DEF)。 */
  async pollAlibaba(): Promise<void> {
    await this.runPoll(ALIBABA_DEF)
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
      await this.ingestClues(provider, feed.clues)
      await this.markSource(provider, true)
    } catch (e) {
      await this.markSource(provider, false).catch(() => {})
      throw e
    }
  }

  /**
   * 线索 upsert-only(2026-08-27 千问/智谱漏检):30 天内条目才入;基线收录后该条目
   * 不再被写入,last_seen_at 停更,读侧 7 天未见即滚出——收录自愈无需删行。滚动信源
   * (百炼)翻走前线索已可见,「漏了什么」不再不可考。
   */
  private async ingestClues(provider: ModelProviderId, clues: PendingClue[]): Promise<void> {
    const cutoff = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10)
    const now = nowIso()
    for (const c of clues) {
      if (c.occurredOn < cutoff) continue
      await this.db
        .insertInto('model_pending_clues')
        .values({
          provider,
          occurred_on: c.occurredOn,
          model_key: c.modelKey,
          title: c.title,
          source_url: c.sourceUrl,
          first_seen_at: now,
          last_seen_at: now,
        })
        .onConflict((oc) =>
          oc
            .columns(['provider', 'model_key'])
            .doUpdateSet({ occurred_on: c.occurredOn, title: c.title, source_url: c.sourceUrl, last_seen_at: now }),
        )
        .execute()
    }
  }

  /** 智谱一轮(差异面见 providers/zhipu.ts 的 ZHIPU_DEF)。 */
  async pollZhipu(): Promise<void> {
    await this.runPoll(ZHIPU_DEF)
  }

  /** Anthropic 一轮(差异面见 providers/anthropic.ts 的 ANTHROPIC_DEF)。 */
  async pollAnthropic(): Promise<void> {
    await this.runPoll(ANTHROPIC_DEF)
  }

  /** xAI 一轮(差异面见 providers/xai.ts 的 XAI_DEF)。 */
  async pollXai(): Promise<void> {
    await this.runPoll(XAI_DEF)
  }

  /** OpenAI 一轮(差异面见 providers/openai.ts 的 OPENAI_DEF)。 */
  async pollOpenAI(): Promise<void> {
    await this.runPoll(OPENAI_DEF)
  }

  /** 月之暗面一轮(资讯+Blog 两页语义由 runPoll 的 urls 多项统一承载,见 MOONSHOT_DEF)。 */
  async pollMoonshot(): Promise<void> {
    await this.runPoll(MOONSHOT_DEF)
  }

  /**
   * 评测一轮(issues/08):LLM 主表 + 五个媒体榜单六路取数(单 Key 限额 1000/日,6h
   * 节奏 ×6 路 ≈ 24 请求/日,远低于限额;结果落库即缓存,满足 API 缓存要求)。任一路
   * 失败 → 整轮按评测源失败处理:保留最后成功快照、只标评测陈旧,不影响任何厂家档案。
   * 未配置 Key 时整体 no-op(不取数、不写状态)。分数漂移只更新快照行(不产动态);
   * 唯产动态的口径 = 运行期模型首次获得评测行(kind 'evaluated',首配接入整轮静默;
   * Benchmark 方法/版本变化免费 API 不暴露、不可检测,为已知上限)。
   */
  async pollEvaluations(): Promise<void> {
    if (this.aaApiKey === '') return
    try {
      const headers = { 'x-api-key': this.aaApiKey }
      const rows: AaEvalRow[] = [
        ...aaRowsFromLlms(await this.deps.fetchText(AA_LLM_URL, 30_000, { headers })),
      ]
      for (const ep of AA_MEDIA_ENDPOINTS) {
        rows.push(
          ...aaRowsFromMedia(await this.deps.fetchText(ep.url, 30_000, { headers }), ep.benchmark),
        )
      }
      await this.replaceEvaluationSnapshot(rows)
      await this.markEvalStatus(true)
    } catch (e) {
      await this.markEvalStatus(false).catch(() => {})
      throw e
    }
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

// ---- 定时轮询(研究 §6:6h 节奏;非整点错开,同 videoUpdates 口径)----

export function startModelTrackingScheduler(service: ModelTrackingService): void {
  schedule('41 */6 * * *', () => service.pollQuietly())
}
