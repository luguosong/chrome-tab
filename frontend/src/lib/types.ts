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

/**
 * 布局设置(见 CONTEXT.md「布局设置」):图标网格的显示几何,按用户持久化、跨设备共享。
 * 与 8×8=64 格容量正交——只改像素几何,不改格子数。
 */
export type LayoutSettings = {
  /** 网格 max-width 上限(px),面板内居中。 */
  gridWidth: number
  /** grid gap(px,行+列)。 */
  gridGap: number
  /** 各档 favicon 像素+内边距同比系数(1.0=默认)。 */
  iconScale: number
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
