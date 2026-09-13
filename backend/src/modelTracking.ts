import { schedule } from 'node-cron'
import { createHash } from 'node:crypto'
import { load } from 'cheerio'
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
  ModelVerificationChainStatus,
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
import type { BaselineRow, CatalogParse, MatchedHit, PendingClue, ProviderDef, RetirementEntry, RetirementParse } from './providers/def'
import { catalogDiffClues, retirementClues, SOURCE_INTERVAL_MS, sourceIsStale } from './providers/def'
import type { SourceRole } from './adjudication'
import { makeAaEvaluations, type AaEvaluations } from './aaEvaluations'
import { makeClueLedger, type ClueLedger } from './clueLedger'
import type { AcceptInsertRow } from './verificationGraph'

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

/** 种子快照的 models 段(2026-09-05 由七个代码基线 + AA_MODEL_MAP 一次性生成;空库首启用,此后不再更新;aaMapping 段归 aaEvaluations.ts 读)。 */
const SEED = seed as { models: BaselineModel[] }

/**
 * 全部跟踪厂家的 provider 定义(取数差异面,ADR-0038):pollProvider 轮询入口的
 * 遍历/查表源;影子核验链(verificationShadow.ts,issues/05)自此处取厂家 def 拼
 * 六类核验白名单。**Record 满配 = 编译期完备性**——新厂家票在 shared 的
 * ModelProviderId 扩了枚举而漏挂此处,编译即报错;顺序与 cron 日志习惯一致。
 */
export const PROVIDERS: Record<ModelProviderId, ProviderDef<unknown>> = {
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

/**
 * HTML 信源页 → 存储与指纹形态:剥脚本/样式与页面框架层(body 直接子级的 header/
 * footer/nav——main 内语义同名元素是正文,剥了会让此类 confined 变化静默漂移指纹),
 * 取 main/body 文本。**同一 URL 无论哪个角色写入都经此单点**(调用方以 def 的 html
 * 声明驱动,不做内容启发式):DeepSeek updates 页同时注册 release 与 retirement,
 * 角色间形态不一会让按 URL 合并的影子快照随轮换角色翻转基准——零上游变化也翻指纹。
 */
export function normalizeSourcePage(content: string, html: boolean): string {
  if (!html) return content
  const $ = load(content)
  $('script, style, noscript').remove()
  $('body').children('header, footer, nav').remove()
  // main 有但无文本(孤立的 </main> 片段/JS 挂载点)时退 body——不让正文蒸发成空快照
  const main = $('main')
  const scope = main.length > 0 && main.text().trim() !== '' ? main : $('body')
  return scope.text().replace(/\s+/g, ' ').trim()
}

/** model_fetch_status.pages 列的守卫解析:坏行(截断写/手改)记 warn 视为空——单行坏
 *  JSON 不该炸消费者(轮询的旧内容回退、影子的快照供给共此策略)。 */
export function parseSourcePages(raw: string | null): Record<string, string> {
  if (raw === null) return {}
  try {
    return JSON.parse(raw) as Record<string, string>
  } catch (e) {
    console.warn('模型追踪:信源快照坏行(pages)视为无快照:', e)
    return {}
  }
}

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
  /** 线索账本(票 .scratch/线索账本/01):model_pending_clues 域行为的单点(入库/核验结果/未决集)。 */
  private readonly ledger: ClueLedger
  /** 评测接入(票 .scratch/评测生命周期/01):六路取数、映射、快照、状态与读侧投影的单点。 */
  private readonly aa: AaEvaluations
  private readonly polling = new Map<ModelProviderId, Promise<void>>()

  constructor(
    private readonly db: Db,
    private readonly deps: ModelTrackingDeps,
    /** Artificial Analysis API Key(issues/08);语义单点在 aaEvaluations 工厂(未配置 = 轮询 no-op、读侧 configured=false)。 */
    aaApiKey = '',
    /** 核验链状态供数(数据健康 UI,ADR-0062 决策五;= verificationShadow.chainStats 注册表读侧,切换后语义不变);缺省 = 尚未成功/零堆积。 */
    private readonly verificationStats?: () => ModelVerificationChainStatus,
  ) {
    this.ledger = makeClueLedger(db)
    this.aa = makeAaEvaluations(db, deps.fetchText, aaApiKey)
  }

  /**
   * 启动初始化(ADR-0058):种子 bootstrap(空库全量灌、存量库回填归属列)取代原
   * 「代码基线每启幂等 upsert」——profile 字段此后以 DB 为准,人工修订/auto 入库
   * 不再被部署刷新。首轮取数照旧不阻塞启动。
   */
  async init(): Promise<void> {
    await this.bootstrapFromSeed()
    await this.aa.ensureSeeded()
    void this.pollProvider()
  }

  /** 空库灌种子(行+事件);存量库(迁移前列全默认)按种子回填 aliases/slugs。幂等。 */
  private async bootstrapFromSeed(): Promise<void> {
    // 旧 aaUnmappedClues 的存量线索(键 aa: 前缀)语义已死(2026-09-05 翻转为自动映射
    // 不再产出),不清会被核验链误核验——AA 模型页被当厂家一手信源。
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
    // 六类健康行(ADR-0062 决策五,票 08):按 (provider, role) 全行直出,stale 判定按
    // 各角色档位口径(慢档页不误报);角色登记齐全度随票 07 落地自然补全,前端按实际
    // 存在的角色分组。行序确定性输出(wire 断言与缓存稳定性)。
    const sources = await this.db.selectFrom('model_fetch_status').selectAll().orderBy('provider', 'asc').orderBy('role', 'asc').execute()
    // 评测读侧经模块(aaEvaluations.ts):行投影与信封是评测方知识,wire 形态直出
    const evalsByModel = await this.aa.byModel()
    const evalStatus = await this.aa.status()
    return {
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
        role: s.role as SourceRole,
        stale: sourceIsStale(s.role as SourceRole, s),
        lastSuccessAt: s.last_success_at ?? null,
      })),
      verificationChain: this.verificationStats?.() ?? { lastSuccessAt: null, deferredCount: 0 },
      evaluations: evalStatus,
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
      // 指定厂家是运维手动补轮,保留 release 强制刷新与失败直抛契约。
      await this.pollSources(PROVIDERS[id], true)
      return
    }
    const jobs = Object.values(PROVIDERS).map((def) =>
      this.pollSources(def).catch((e) => console.error(`模型追踪(${def.label})取数失败:`, e)),
    )
    jobs.push(
      this.aa.poll().catch((e) => console.error('模型追踪(评测)取数失败:', e)),
    )
    await Promise.all(jobs)
  }

  private pollSources(def: ProviderDef<unknown>, forceRelease = false): Promise<void> {
    const active = this.polling.get(def.id)
    // 非强制直接并入在飞轮;强制(运维手动补轮)排在在飞轮之后真跑——cron 轮已按档位
    // 跳过 release,复用它会让强制刷新静默落空。排队 promise 同样登记进 map,后来者
    // 一并串行,不会双轮并发写同一 (provider, role) 行。finally 只删**自己**的登记:
    // 在飞轮落定时会把已排队轮占住的槽一并删掉,后续调用者看不见在飞任务而并发起跑。
    if (active !== undefined && !forceRelease) return active
    const job = (active ?? Promise.resolve()).catch(() => {})
      .then(() => this.pollSourceRoles(def, forceRelease))
    job.finally(() => {
      if (this.polling.get(def.id) === job) this.polling.delete(def.id)
    }).catch(() => {})
    this.polling.set(def.id, job)
    return job
  }

  private async pollSourceRoles(def: ProviderDef<unknown>, forceRelease: boolean): Promise<void> {
    // cron 精度为分钟:取本轮起点,避免抓取耗时/毫秒抖动把 2h 档拖成 4h。
    const attemptedAt = new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString()
    // 轮级 URL 去重缓存(存 raw):同 URL 多角色共注册(智谱 overview.md ×3、深求
    // updates 页 release+retirement)在档位重合轮只抓一次——角色串行遍历,无并发。
    const rawCache = new Map<string, string>()
    const fetchRaw = async (url: string): Promise<string> => {
      const hit = rawCache.get(url)
      if (hit !== undefined) return hit
      const raw = await this.deps.fetchText(url, 30_000)
      rawCache.set(url, raw)
      return raw
    }
    let releaseError: unknown
    for (const role of Object.keys(SOURCE_INTERVAL_MS) as SourceRole[]) {
      const status = await this.db.selectFrom('model_fetch_status').selectAll()
        .where('provider', '=', def.id).where('role', '=', role).executeTakeFirst()
      if (status !== undefined && status.stale === 0 && sourceIsStale(role, status)) {
        await this.db.updateTable('model_fetch_status').set({ stale: 1 })
          .where('provider', '=', def.id).where('role', '=', role).execute()
      }
      if (!(forceRelease && role === 'release') && status?.last_attempt_at !== null &&
        status?.last_attempt_at !== undefined && Date.now() - Date.parse(status.last_attempt_at) < SOURCE_INTERVAL_MS[role]) continue
      try {
        const pages: Record<string, string> = {}
        if (role === 'release') {
          for (const [url, raw] of Object.entries(await this.runPoll(def, fetchRaw))) {
            const content = normalizeSourcePage(raw, def.sources.release.html ?? false)
            if (content.trim() === '') throw new Error('信源页为空') // 正文全在框架层:空存储不可标健康
            pages[url] = content
          }
        } else {
          // 多页角色逐页容错:单页失败不弃整轮——有旧快照沿用旧内容(指纹与快照不因
          // 间歇失败翻转),无旧内容的失败页缺席;全败才走角色失败(HF 仓库改名是常态,
          // 一页 404 不该让其余好快照陪葬到整角色不可用)。失败一律入 pageErrs(回退与
          // 收集是两件事:全败时 pageErrs[0] 才是真实错误而非 undefined)。
          const prevPages = parseSourcePages(status?.pages ?? null)
          const pageErrs: unknown[] = []
          let fetched = 0
          const freshRaws: Array<{ url: string; raw: string }> = []
          for (const url of def.sources[role].urls) {
            try {
              const raw = await fetchRaw(url)
              const content = normalizeSourcePage(raw, def.sources[role].html ?? false)
              if (content.trim() === '') throw new Error('信源页为空')
              pages[url] = content
              fetched++
              freshRaws.push({ url, raw })
            } catch (e) {
              pageErrs.push(e)
              if (prevPages[url] !== undefined) pages[url] = prevPages[url]!
            }
          }
          if (fetched === 0) throw pageErrs[0]
          for (const e of pageErrs) console.error(`模型追踪(${def.label}/${role})单页失败:`, e)
          // 条目级角色(票 07):目录差集与退役公告在本轮新鲜抓取上产线索(改版零条目
          // 抛错在前,标陈旧不产线索——与发布源同契约)
          const parse = def.sources[role].parse
          if (parse !== 'fingerprint' && (role === 'catalog' || role === 'retirement')) {
            await this.ingestRoleEntries(def, role, parse, freshRaws)
          }
        }
        const serialized = JSON.stringify(Object.entries(pages).sort(([a], [b]) => a.localeCompare(b)))
        await this.markSource(def.id, true, role, {
          pages: JSON.stringify(pages), fingerprint: createHash('sha256').update(serialized).digest('hex'),
        }, attemptedAt)
      } catch (e) {
        await this.markSource(def.id, false, role, undefined, attemptedAt).catch(() => {})
        if (role === 'release') releaseError = e
        else console.error(`模型追踪(${def.label}/${role})取数失败:`, e)
      }
    }
    if (releaseError !== undefined) throw releaseError
  }

  /**
   * 目录/退役角色的条目级线索生成(票 07):解析**本轮新鲜抓取**的原始页——回退旧快照
   * 不重解析(旧内容的线索已在其新鲜轮入账,账本冻结语义天然幂等)。目录差集线索键 =
   * 裸 ID(occurredOn = 观察日,目录页不携带模型日期);退役线索键 = 条目 ID/命中别名,
   * occurredOn = 公告日期(30 天入库窗天然只放行新鲜公告,历史弃用不重复触达)。目录
   * 零条目 = 上游改版口径(抛错由调用方标陈旧,同发布源契约);退役零条目合法(当期
   * 无弃用公告)。线索经线索账本入库,旧链 auto 核验与影子链同一协议消费。
   */
  private async ingestRoleEntries(
    def: ProviderDef<unknown>,
    role: 'catalog' | 'retirement',
    parse: CatalogParse | RetirementParse,
    freshRaws: ReadonlyArray<{ url: string; raw: string }>,
  ): Promise<void> {
    const rows = await this.baselineRows(def.id)
    const clues: PendingClue[] = []
    let entries = 0
    for (const { url, raw } of freshRaws) {
      // role 与 parse 形态由 ProviderSources 静态绑定(catalog→CatalogParse),此处断言收窄
      const r = role === 'catalog' ? (parse as CatalogParse)(raw) : (parse as RetirementParse)(raw)
      if (r.skipped.length > 0) {
        console.warn(`模型追踪(${def.label}/${role})意外跳过 ${r.skipped.length} 条:`, r.skipped.slice(0, 5))
      }
      entries += r.entries.length
      clues.push(...(role === 'catalog'
        ? catalogDiffClues(r.entries as string[], rows, { occurredOn: nowIso().slice(0, 10), sourceUrl: url })
        : retirementClues(r.entries as RetirementEntry[], rows, url)))
    }
    if (role === 'catalog' && entries === 0) throw new Error('目录源无结构化条目(疑似上游改版)')
    await this.ledger.ingest(def.id, clues)
  }

  /**
   * 一轮厂家取数的统一巡走(ADR-0038):逐信源页 fetch→解析→零条目判改版→逐条目
   * 分派(命中/线索)→入库;任一页失败先吞后聚、循环后上抛首个错误——**终态
   * markSource 全归 pollSourceRoles 单写**(release 成功含 pages/指纹快照同拍落地,
   * 失败/成功不因页面间处理错位),后一页的成功不会覆盖前一页的失败标记。逐厂家的
   * 差异(信源/解析/匹配/线索)全部在 ProviderDef,此处不出现厂家分支。线索的核验
   * 在轮询之外(核验链 2h 同节奏重扫,verificationShadow.ts;issues/11 切换接管)。
   */
  private async runPoll(def: ProviderDef<unknown>, fetchRaw: (url: string) => Promise<string>): Promise<Record<string, string>> {
    const errs: unknown[] = []
    const pages: Record<string, string> = {}
    const rows = await this.baselineRows(def.id)
    for (const url of def.sources.release.urls) {
      try {
        pages[url] = await this.pollOne(def.id, url, (md) => {
          const { entries, skipped } = def.sources.release.parse(md)
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
        }, fetchRaw)
      } catch (e) {
        errs.push(e)
      }
    }
    if (errs.length > 0) throw errs[0]
    return pages
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
   * 一轮取数的公共失败口径(fetch 抛错与「200 但零结构化条目」= 上游改版,均抛错由
   * pollSourceRoles 统一标陈旧、保留库内最后成功结果,不静默清零)。结构差异(解析
   * 器/匹配器/线索提取)由 ProviderDef 闭合(runPoll 组装),返回 null 即「解析不出
   * 任何结构化条目」。
   */
  private async pollOne(
    provider: ModelProviderId,
    url: string,
    parseAndMatch: (md: string) => ParsedFeed | null,
    fetchRaw: (url: string) => Promise<string>,
  ): Promise<string> {
    const md = await fetchRaw(url)
    const feed = parseAndMatch(md)
    if (feed === null) throw new Error('发布源无结构化条目(疑似上游改版)')
    await this.ingest(provider, feed.hits)
    await this.ledger.ingest(provider, feed.clues)
    return md
  }

  private async markSource(provider: ModelProviderId, ok: boolean, role: SourceRole = 'release', snapshot?: { pages: string; fingerprint: string }, attemptedAt = nowIso()): Promise<void> {
    const now = nowIso()
    await this.db
      .insertInto('model_fetch_status')
      .values({
        provider,
        role,
        ...snapshot,
        stale: ok ? 0 : 1,
        last_success_at: ok ? now : null,
        last_attempt_at: attemptedAt,
      })
      .onConflict((oc) =>
        oc.columns(['provider', 'role']).doUpdateSet({
          stale: ok ? 0 : 1,
          ...(ok ? { last_success_at: now } : {}),
          last_attempt_at: attemptedAt,
          ...snapshot,
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

/**
 * 核验链接纳计划的档案插行(issues/11 切换写库):verified='auto' 的 insert,冲突
 * (人工已收录/已插过)静默跳过——修订不覆盖,取 id 归调用方(verificationShadow 的
 * 图内最终事务,同事务内与证据行/事件原子提交)。
 */
export async function insertAutoArchiveRow(db: Pick<Db, 'insertInto' | 'selectFrom'>, row: AcceptInsertRow): Promise<number> {
  await db
    .insertInto('model_archive')
    .values({
      provider: row.provider,
      official_id: row.officialId,
      name: row.name,
      kind: row.kind,
      stage: row.stage,
      availability: JSON.stringify(row.availability),
      summary: row.summary,
      sources: JSON.stringify(row.sources),
      pricing: null,
      limits: null,
      training_params: null,
      match_aliases: JSON.stringify(row.matchAliases),
      match_slugs: '[]',
      verified: 'auto',
      created_at: nowIso(),
      updated_at: nowIso(),
    })
    .onConflict((oc) => oc.columns(['provider', 'official_id']).doNothing())
    .execute()
  const existing = await db
    .selectFrom('model_archive')
    .select('id')
    .where('provider', '=', row.provider)
    .where('official_id', '=', row.officialId)
    .executeTakeFirstOrThrow()
  return existing.id
}

// ---- 定时轮询(ADR-0058「当天时效」:6h→2h;非整点错开,同 videoUpdates 口径)----

/**
 * 2h cron 既驱动轮询也驱动重扫(spec 调度与执行;ADR-0062):afterPoll 在每轮取数落定后
 * 调用——影子核验链(verificationShadow.ts,issues/05)借此同节奏重扫,线索先经轮询入库
 * 再进影子集。钩子缺席时行为与既往完全一致(旧链零变化)。
 */
export function startModelTrackingScheduler(service: ModelTrackingService, afterPoll?: () => void): void {
  schedule('41 */2 * * *', () => void service.pollProvider().finally(() => afterPoll?.()))
}
