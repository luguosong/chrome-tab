export type Me = { id: number; username: string }

// ── 新模型（Icon/Page,见 CONTEXT.md / ADR-0001）──────────────────────────
/**
 * 图标类型 id,对齐后端 IconType 枚举(小写串)。后端 Jackson 默认序列化为大写
 * ("NAV"/"STOCK"/"CHANGELOG"),前端在 config.ts 解析时归一化为小写,使注册表查询干净。
 */
export type IconTypeId = 'nav' | 'stock' | 'changelog' | 'weather' | 'group'

/**
 * 三档尺寸,对齐后端 Size 枚举(小写)。后端 Jackson 默认序列化为大写
 * ("SMALL"/"MEDIUM"/"LARGE"),前端在 config.ts 解析时归一化为小写。
 * 8 列网格:small=1×1 / medium=2×2 / large=3×2。
 */
export type IconSize = 'small' | 'medium' | 'large'

/** 走马灯一屏:图标的容器(见 CONTEXT.md「页面」)。 */
export type Page = { id: number; name: string; sortOrder: number }

/** 图标实例(见 CONTEXT.md「图标」)。data 为类型专属配置(nav={name,url} / stock={symbol,name} / changelog=null)。
 *  parentId:分组成员的组行 id(ADR-0011),顶层图标为 null。 */
export type Icon = {
  id: number
  pageId: number
  parentId: number | null
  type: IconTypeId
  size: IconSize
  sortOrder: number
  data: Record<string, unknown> | null
}

/** 搜索引擎 id(与后端 LayoutLimits 校验白名单一致)。 */
export type SearchEngineId = 'google' | 'bing' | 'baidu'

/**
 * 布局设置(见 CONTEXT.md「布局设置」,五组):按用户持久化、跨设备共享。
 * 网格组与 8×8=64 格容量正交——只改像素几何,不改格子数;favicon 自相似推导只随
 * gridGap(横向),gridGapY(竖向)不参与。
 */
export type LayoutSettings = {
  /** 网格 max-width 上限(px),面板内居中。 */
  gridWidth: number
  /** 横向间距(px,列 gap;原「图标间距」拆分后的横向半边)。 */
  gridGap: number
  /** 竖向间距(px,行 gap;固定画布不滚动,上限比横向宽)。 */
  gridGapY: number
  /** 各档 favicon 像素+内边距同比系数(1.0=默认)。 */
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

/** GET /api/config 聚合响应。03 ticket 后:旧字段 navLinks/stockWatches/setting 已删除;
 *  新模型为 pages/icons,布局设置经 layoutSettings 下发。updatedAt 为整体配置版本(ADR-0006),
 *  任意配置写前进;前端镜像据此与服务端 LWW。后端返回大写枚举,这里声明的是归一化后的形态(见 config.ts)。 */
export type Config = {
  pages: Page[]
  icons: Icon[]
  layoutSettings: LayoutSettings
  /** 整体配置版本(ISO),无版本行时为 null。镜像和解用(见 ADR-0006 / lib/mirror/reconcile)。 */
  updatedAt: string | null
}
