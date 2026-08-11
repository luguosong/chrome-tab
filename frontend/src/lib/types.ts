export type Me = { id: number; username: string }

export type NavLink = { id: number; name: string; url: string; sortOrder: number }

export type StockWatch = {
  id: number
  symbol: string
  name: string
  groupName: string
  sortOrder: number
}

export type Setting = { theme: string }

// ── 新模型（Icon/Page,见 CONTEXT.md / ADR-0001）──────────────────────────
/**
 * 图标类型 id,对齐后端 IconType 枚举(小写串)。后端 Jackson 默认序列化为大写
 * ("NAV"/"STOCK"/"CHANGELOG"),前端在 config.ts 解析时归一化为小写,使注册表查询干净。
 */
export type IconTypeId = 'nav' | 'stock' | 'changelog'

/**
 * 三档尺寸,对齐后端 Size 枚举(小写)。后端 Jackson 默认序列化为大写
 * ("SMALL"/"MEDIUM"/"LARGE"),前端在 config.ts 解析时归一化为小写。
 * 6 列网格:small=1×1 / medium=2×2 / large=3×2。
 */
export type IconSize = 'small' | 'medium' | 'large'

/** 走马灯一屏:图标的容器(见 CONTEXT.md「页面」)。 */
export type Page = { id: number; name: string; sortOrder: number }

/** 图标实例(见 CONTEXT.md「图标」)。data 为类型专属配置(nav={name,url} / stock={symbol,name} / changelog=null)。 */
export type Icon = {
  id: number
  pageId: number
  type: IconTypeId
  size: IconSize
  sortOrder: number
  data: Record<string, unknown> | null
}

/** GET /api/config 聚合响应。expand 阶段:旧字段保留(03 ticket 删除),新字段已就绪。
 *  后端返回大写枚举,这里声明的是归一化后的形态(见 config.ts 的 transform)。 */
export type Config = {
  navLinks: NavLink[]
  stockWatches: StockWatch[]
  pages: Page[]
  icons: Icon[]
  setting: Setting
}
