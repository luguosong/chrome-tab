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
 * ADR-0025)。occurredOn 为 YYYY-MM-DD——信源只有日期粒度(智谱发布页 Update label),
 * 24h 红点窗口按北京时间零点锚定在前端推导(见 frontend lib/modelTracking.ts)。
 * issues/01 贯通智谱文本首片;issues/02 补齐智谱八类全量档案;ModelProviderId 随后续厂家票扩。
 */
export type ModelProviderId = 'zhipu'

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

/** 模型动态类型(CONTEXT.md「模型动态」;自动解析只产 updated,语义化类型留给人工核验基线)。 */
export type ModelEventKind =
  | 'released'
  | 'api_available'
  | 'first_party_available'
  | 'weights_available'
  | 'updated'
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

/** 模型定价(issues/02):开放平台现价。region 为平台/地区作用域;effectiveFrom 为官方生效日,价格页未标注 → null(展示现价)。 */
export type ModelPricing = {
  region: string
  effectiveFrom: string | null
  entries: ModelPriceEntry[]
}

/** 官方限额条目(上下文/最大输出/输入大小等):text 保留官方原文值;scope 为作用域原文(如「音频通话」),无 → null。 */
export type ModelLimit = {
  label: string
  text: string
  scope: string | null
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
  /** 官方披露的训练参数量原文(如「744B(激活 40B)」);未披露 → null(显示「未知」)。 */
  trainingParams: string | null
  events: ModelEvent[]
}

/** 信源取数状态:失败保留最后成功结果并标记陈旧(CONTEXT.md「模型档案」)。 */
export type ModelSourceStatus = {
  provider: ModelProviderId
  stale: boolean
  /** 最近一次成功取数(ISO);null = 尚未成功过(档案为人工核验基线)。 */
  lastSuccessAt: string | null
}

/** GET /api/model-tracking/archive 信封。 */
export type ModelArchiveResponse = {
  models: TrackedModel[]
  sources: ModelSourceStatus[]
}

export * from './changelogSources'

/**
 * 布局设置(见 CONTEXT.md「布局设置」,五组):按用户持久化、跨设备共享。
 * 网格组与 8×8=64 格容量正交——只改像素几何,不改格子数。
 */
export type LayoutSettings = {
  /** 网格 max-width 上限(px),面板内居中。 */
  gridWidth: number
  /** 横向间距(px,列 gap;原「图标间距」拆分后的横向半边)。 */
  gridGap: number
  /** 竖向间距(px,行 gap;固定画布不滚动,上限比横向宽)。 */
  gridGapY: number
  /** favicon 像素+内边距+小组件字号的同比系数,图标整体大小的唯一调节(默认 1.5,ADR-0016)。 */
  iconScale: number
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
}
