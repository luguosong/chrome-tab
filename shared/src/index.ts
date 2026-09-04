/**
 * 双端共享契约(前端 TS / 后端重写后的 Node):纯类型与常量,双端直引 TS 源、零构建。
 * 架构决策见 ADR-0018;此处类型变更即契约变更,需双端同步评审。
 */

/** 搜索引擎 id(与后端 LayoutLimits 校验白名单一致)。 */
export type SearchEngineId = 'google' | 'bing' | 'baidu'

/**
 * 视频更新 wire 契约(CONTEXT.md「视频更新/博主/分类」;数据落 SQLite、后端轮询预取,
 * ADR-0023/0024)。publishedAt 为 unix 秒(跨平台统一口径,B站 created 原生、YouTube ISO 转换);
 * 可空字段对应降级口径(无 key 时 YouTube 缺时长头像,存量不回补)。
 */
export type VideoPlatform = 'youtube' | 'bilibili'

export type VideoFeedItem = {
  id: number
  title: string
  url: string
  thumbnailUrl: string | null
  durationSeconds: number | null
  publishedAt: number
  bloggerId: number
  bloggerName: string
  platform: VideoPlatform
  categoryId: number | null
}

export type VideoCategory = { id: number; name: string; sortOrder: number }

/** GET /api/video-updates/categories 信封:列表恒带各分类博主数(管理 tab 与 tab 显隐用)。 */
export type VideoCategoriesResponse = {
  categories: Array<VideoCategory & { bloggerCount: number }>
  uncategorizedCount: number
}

export type VideoBlogger = {
  id: number
  platform: VideoPlatform
  platformUserId: string
  name: string
  avatarUrl: string | null
  /** null = 未分类(虚拟桶,非实体)。 */
  categoryId: number | null
  /** 连续 24 轮取数失败标红「取数失败」,不自动删;成功即回 ok。 */
  status: 'ok' | 'failing'
}

/**
 * 模型追踪 wire 契约(CONTEXT.md「模型追踪/跟踪模型/模型档案」等;全局持久档案,
 * ADR-0025)。occurredOn 为 YYYY-MM-DD——信源粒度随厂家(智谱发布页 Update label 与
 * Anthropic release notes 日期标题到日;xAI 发布流仅月份标题,事件锚定当月 1 日),
 * 24h 红点窗口按北京时间零点锚定在前端推导(见 frontend lib/modelTracking.ts)。
 * issues/01 贯通智谱文本首片;issues/02 补齐智谱八类全量档案;issues/03 接入
 * OpenAI;issues/04 接入 Anthropic;issues/05 接入 xAI;issues/06 接入月之暗面;issues/07 接入
 * DeepSeek;issues/09 接入阿里通义;ModelProviderId 随后续厂家票扩。
 */
export type ModelProviderId =
  | 'zhipu'
  | 'openai'
  | 'anthropic'
  | 'xai'
  | 'moonshot'
  | 'deepseek'
  | 'alibaba'

/** 模型种类(CONTEXT.md「模型种类」,八类;与发布阶段/开放方式正交)。 */
export type ModelKind =
  | 'text'
  | 'multimodal_understanding'
  | 'image_generation'
  | 'video_generation'
  | 'audio_speech'
  | 'embedding'
  | 'rerank'
  | 'moderation_classification'

/** 发布阶段(CONTEXT.md「发布阶段」)。 */
export type ReleaseStage = 'experimental' | 'preview' | 'beta' | 'ga' | 'deprecated' | 'retired'

/** 开放方式(CONTEXT.md「开放方式」;同一模型可多选)。 */
export type AvailabilityMode = 'api' | 'first_party_app' | 'open_weights'

/** 模型动态类型(CONTEXT.md「模型动态」;自动解析只产 updated/evaluated,语义化类型留给人工核验基线;alias_repointed = 移动别名/退役 ID 换指向,随 issues/05 xAI 引入;evaluated = 首次进入外部评测,随 issues/08 引入)。 */
export type ModelEventKind =
  | 'released'
  | 'api_available'
  | 'first_party_available'
  | 'weights_available'
  | 'updated'
  | 'evaluated'
  | 'alias_repointed'
  | 'deprecated'
  | 'retired'

export type ModelEvent = {
  id: number
  kind: ModelEventKind
  /** YYYY-MM-DD(信源日期粒度)。 */
  occurredOn: string
  title: string
  sourceUrl: string
}

/** 官方价格条目(issues/02):text 保留官方原文(币种/数值/单位一并,如「输入 8 元/百万 tokens」「免费」);scope 为官方标注的作用域原文(如「输入长度 [0, 32)」),无 → null。 */
export type ModelPriceEntry = {
  text: string
  scope: string | null
}

/** 模型定价(issues/02):开放平台现价。region 为平台/地区作用域;effectiveFrom 为官方生效日,价格页未标注 → null(展示现价)。智谱现价全部为单一平台口径故 region 在模型级——多地区厂家接入时升为条目级字段。 */
export type ModelPricing = {
  region: string
  effectiveFrom: string | null
  entries: ModelPriceEntry[]
}

/** 官方限额条目(上下文/最大输出/输入大小等):text 保留官方原文值;scope 为官方作用域原文(如「音频通话」「输入长度 [0, 32)」),无 → null。厂家限额标注套餐/地区时同样经 scope 原文保留(智谱现额未按套餐/地区区分,scope 留空即无此维度)。 */
export type ModelLimit = {
  label: string
  text: string
  scope: string | null
}

/** 官方披露的训练参数量(CONTEXT.md「训练参数量」:MoE 总/激活分别记录,不混为一值;未披露 → null 显示「未知」)。 */
export type ModelTrainingParams = {
  /** 总参数量官方原文(如「744B」)。 */
  total: string
  /** MoE 激活参数量官方原文(如「40B」);非 MoE 或官方未单独披露 → null。 */
  active: string | null
}

/**
 * 单条评测结果(CONTEXT.md「评测结果」;issues/08 首接 Artificial Analysis):分数为
 * 评测方原始值,不跨 Benchmark 归一、不合成综合分;date 为快照日期(API 无逐项评测
 * 日期,以取数日为准);url 为该模型页原始链接。
 */
export type ModelEvaluation = {
  /** 评测方展示名(如 'Artificial Analysis';归因链接由前端固定挂评测区头)。 */
  evaluator: string
  /** Benchmark 稳定 key(llm:artificial_analysis_intelligence_index/mmlu_pro…;媒体:<endpoint>_elo),前端映射展示名。 */
  benchmark: string
  /** 原始分数(Elo 大整数/指数 0-100/准确率 0-1 原样保留,格式化在前端)。 */
  score: number
  /** 被评测的模型版本名(评测方口径,如 'GPT Image 1 (high)')。 */
  version: string
  /** YYYY-MM-DD(快照日期,北京时间)。 */
  date: string
  /** 评测方模型页链接。 */
  url: string
}

export type TrackedModel = {
  id: number
  provider: ModelProviderId
  /** 上游官方模型 ID/家族(如 glm-5.3);移动别名与日期快照不另立模型。 */
  officialId: string
  name: string
  kind: ModelKind
  stage: ReleaseStage
  availability: AvailabilityMode[]
  summary: string | null
  /** 基本资料的原始信源(模型文档页等)。 */
  sources: Array<{ title: string; url: string }>
  /** 官方定价;官方渠道未核验到现价 → null(前端显示「官方未披露」)。 */
  pricing: ModelPricing | null
  /** 上下文与其他官方限额;未披露 → null。 */
  limits: ModelLimit[] | null
  trainingParams: ModelTrainingParams | null
  /** 外部评测结果(issues/08,CONTEXT.md「评测结果」);精确匹配不到 → 空数组。 */
  evaluations: ModelEvaluation[]
  events: ModelEvent[]
}

/** 信源取数状态:失败保留最后成功结果并标记陈旧(CONTEXT.md「模型档案」)。 */
export type ModelSourceStatus = {
  provider: ModelProviderId
  stale: boolean
  /** 最近一次成功取数(ISO);null = 尚未成功过(档案为人工核验基线)。 */
  lastSuccessAt: string | null
}

/**
 * 评测源整体状态(issues/08):与厂家信源状态隔离——评测源失败只标记评测陈旧,不
 * 影响任一厂家档案(CONTEXT.md「评测结果」)。configured=false(服务端未配 Key)时
 * 恒不陈旧、无成功时间,前端评测区显示「未配置」。
 */
export type ModelEvaluationsStatus = {
  configured: boolean
  stale: boolean
  lastSuccessAt: string | null
}

/** GET /api/model-tracking/archive 信封。 */
export type ModelArchiveResponse = {
  models: TrackedModel[]
  sources: ModelSourceStatus[]
  evaluations: ModelEvaluationsStatus
  /** 待核验线索(解析出但基线未认领的条目,ADR-0025 可见形态;近 7 天仍出现的,倒序)。 */
  pendingClues: ModelPendingClue[]
}

/** 待核验线索一行:新条目出现在厂家发布源但不在人工核验基线——核验后纳入即自愈消失。 */
export type ModelPendingClue = {
  provider: ModelProviderId
  /** YYYY-MM-DD。 */
  date: string
  title: string
  url: string
}

export * from './iconTypes'
export * from './changelogSources'
export * from './newsSources'
export * from './trending'

/**
 * 重要日期条目(CONTEXT.md「重要日子」,倒计时的用户配置数据源;寄放布局设置见
 * ADR-0026)。date 为 YYYY-MM-DD 字面值,语义随 calendar/repeat:**annual 时年份
 * 无意义**(每年按月日循环,农历按当年换算公历);once 为完整日期。农历日期即
 * 用户输入的农历月日原样(如 1990-08-15 表示农历八月十五),闰月不区分。
 */
export type ImportantDate = {
  id: string
  name: string
  /** YYYY-MM-DD;calendar='lunar' 时月日按农历解读。 */
  date: string
  calendar: 'solar' | 'lunar'
  repeat: 'annual' | 'once'
}

/**
 * 布局设置(见 CONTEXT.md「布局设置」,五组):按用户持久化、跨设备共享。
 * 网格组与 9×9=81 格容量正交——只改像素几何,不改格子数。
 */
export type LayoutSettings = {
  /** 网格 max-width 上限(px),面板内居中。 */
  gridWidth: number
  /** 横向间距(px,列 gap;原「图标间距」拆分后的横向半边)。 */
  gridGap: number
  /** 竖向间距(px,行 gap;固定画布不滚动,上限比横向宽)。 */
  gridGapY: number
  /** 页板雾化浓度(%,暗色底 alpha×100;0=面板全透,blur 不变)。 */
  panelFog: number
  /** 搜索栏最大宽度(px)。 */
  searchBarWidth: number
  searchBarVisible: boolean
  searchEngine: SearchEngineId
  clockVisible: boolean
  /** 时钟大字时间行字号(px),日期小行不随动。 */
  clockFont: number
  clock24h: boolean
  /** 图标名称(含分组名)显隐/字号/颜色。 */
  labelVisible: boolean
  labelSize: number
  labelColor: string
  /** 重要日子(寄放,ADR-0026;缺省 = 空列表,存量/旧客户端兼容)。 */
  importantDates: ImportantDate[]
}

/**
 * 服务器状态 wire 契约(CONTEXT.md「服务器状态」):thinkpad/aliyun 各跑一个
 * servermon exporter(thinkpad-ubuntu 仓库 scripts/servermon),backend 按需抓取
 * + 60s TTL 快照、cron 10min 采样落库数值曲线。exporter 输出 snake_case,
 * 本契约统一 camelCase(解析层映射,同 trending 口径)。
 */
export type ServerMonSnapshot = {
  host: string
  /** 采集时刻(exporter 侧 UTC ISO) */
  ts: string
  /** CPU 使用率(%,后台 10s 采样;首次启动 10s 内为 0) */
  cpuPct: number
  load1: number
  memTotal: number
  memAvail: number
  diskTotal: number
  diskFree: number
  uptimeS: number
  failedUnits: number
  /** systemd 单元状态(units.txt 配置;timer 附 result = 上次触发结果) */
  services: Record<string, { state: string; result?: string }>
  /** docker 容器名 → 状态(running/exited/…) */
  containers: Record<string, string>
}

/** GET /api/servers 单机条目:抓不到 = offline(可达性兼任拨测,无独立 ping)。 */
export type ServerMonEntry = {
  machine: string
  status: 'online' | 'offline'
  /** 最后成功快照;offline 时为旧数据(宁旧勿空),null = 从未成功过 */
  snapshot: ServerMonSnapshot | null
  /** backend 实际取到该快照的时间(降级时早于当前,前端据此示陈旧) */
  fetchedAt: string | null
}

/** GET /api/servers/history 单点(server_samples 落库曲线,10min 粒度)。 */
export type ServerMonHistoryPoint = {
  ts: string
  cpuPct: number
  load1: number
  memAvail: number
  diskFree: number
}
