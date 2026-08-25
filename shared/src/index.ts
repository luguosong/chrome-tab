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
