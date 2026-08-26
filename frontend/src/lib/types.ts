export type Me = { id: number; username: string }

// ── 新模型（Icon/Page,见 CONTEXT.md / ADR-0001）──────────────────────────
/**
 * 图标类型 id,对齐后端 IconType 枚举(小写串)。后端 Jackson 默认序列化为大写
 * ("NAV"/"STOCK"/"CHANGELOG"),前端在 config.ts 解析时归一化为小写,使注册表查询干净。
 */
export type IconTypeId =
  | 'nav'
  | 'stock'
  | 'changelog'
  | 'weather'
  | 'aihot'
  | 'todo'
  | 'video'
  | 'model'
  | 'news'
  | 'group'

/** 走马灯一屏:图标的容器(见 CONTEXT.md「页面」)。 */
export type Page = { id: number; name: string; sortOrder: number }

/** 图标实例(见 CONTEXT.md「图标」)。data 为类型专属配置(nav={name,url} / stock={symbol,name} / changelog=null)。
 *  parentId:分组成员的组行 id(ADR-0011),顶层图标为 null。图标一律占 1 格、无尺寸档位(ADR-0016)。 */
export type Icon = {
  id: number
  pageId: number
  parentId: number | null
  type: IconTypeId
  sortOrder: number
  data: Record<string, unknown> | null
}

// 双端契约类型移驻 shared(workspace 包,直引 TS 源零构建);此处 re-export 保住既有引用方。
import type { LayoutSettings, SearchEngineId } from 'chrome-tab-shared'
export type { LayoutSettings, SearchEngineId }

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
