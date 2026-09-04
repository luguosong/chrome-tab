/**
 * 图标类型的身份/跨度/单例单源(ADR-0057):前端注册表(frontend lib/iconTypeRegistry.ts)
 * 与后端容量口径(backend src/icons.ts)共用的那份事实。此前同一枚举五处手写、两形态
 * (小写 union / 大写数组)、跨度两形态({w,h} / 格数数字),同步靠注释——weather 跨度
 * 失步(后端按 3 格收容量、前端 2026-09-01 已收回 1×1)是注释机制失效的实证。
 * 前后端共享:后端按它派生容量格数与单例校验,前端注册表按它展开 span/singleton
 * (label/editor 等前端专属元数据不入本表,ADR-0001「是什么/怎么渲染」分工)。
 */

/** 图标类型 id(前端小写形态;wire/DB 为大写,往返无损,见 toWireType/fromWireType)。 */
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
  | 'trending'
  | 'servers'
  | 'countdown'
  | 'group'

/** wire/DB 大写形态(后端枚举与历史存量数据)。 */
export type IconWireType = Uppercase<IconTypeId>

/** 画格跨度(ADR-0021):w 列 × h 行,缺省 1×1。渲染层据此 CSS grid span,容量按 w×h 计。 */
export type IconSpan = { w: number; h: number }

/** 双端共用的类型元数据。 */
export interface IconTypeMeta {
  /** 画格跨度;缺省(不声明)= 1×1。 */
  span?: IconSpan
  /** 单例类型(见 CONTEXT.md「单例类型」):全局仅一个实例。 */
  singleton: boolean
}

/** 键序 = 前端注册表键序(新增抽屉分区渲染顺序:基础先于扩展)。 */
export const ICON_TYPE_META: Record<IconTypeId, IconTypeMeta> = {
  nav: { singleton: false },
  stock: { singleton: false },
  changelog: { singleton: false, span: { w: 3, h: 2 } },
  // weather 无 span:2026-09-01 前端收回 1×1(曾 3×1 跨格);后端容量口径曾漏跟(ADR-0057 修正)。
  weather: { singleton: false },
  aihot: { singleton: true, span: { w: 3, h: 2 } },
  todo: { singleton: true, span: { w: 3, h: 2 } },
  video: { singleton: true, span: { w: 3, h: 2 } },
  model: { singleton: true, span: { w: 3, h: 2 } },
  news: { singleton: true, span: { w: 3, h: 2 } },
  trending: { singleton: true, span: { w: 3, h: 2 } },
  servers: { singleton: true, span: { w: 3, h: 2 } },
  countdown: { singleton: true },
  group: { singleton: false },
}

/** 前端小写 id → wire/DB 大写。 */
export function toWireType(id: IconTypeId): IconWireType {
  return id.toUpperCase() as IconWireType
}

/** wire/DB 大写 → 前端小写 id。不校验合法性:未知值同样小写化透传(类型断言,
 *  未知类型的容错归渲染层,与旧 config.ts 内联归一化同语义)。 */
export function fromWireType(wire: string): IconTypeId {
  return wire.toLowerCase() as IconTypeId
}
