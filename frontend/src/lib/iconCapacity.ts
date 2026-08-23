/**
 * 容量约定与纯函数（对齐 ADR-0002 与 CONTEXT.md「页面容量」）。
 * 后端单一事实源：DEFAULT_CAPACITY_CELLS（见 backend）。
 * 前端镜像此约定用于即时反馈（角标、新增抽屉预校验），服务端校验为最终防线。
 *
 * 图标默认占 1 格,类型可声明 size 跨格(ADR-0021):cellsUsed = Σ w×h(顶层行)。
 * DOM-free,可直接 Vitest 断言;组件层只做 UI 编排,纯逻辑不进组件。
 */
import type { IconTypeId } from './types'
import { iconCells } from './iconTypeRegistry'

/** 后端兜底默认容量（固定 9 × 9 = 81 格）。角标以此为准：与服务端最终校验一致。 */
export const DEFAULT_PAGE_CAPACITY = 81

/** 最小调用形态。parentId 用于分组容量语义(ADR-0011),type 用于格数(ADR-0021)。 */
export type PageIcon = { parentId?: number | null; type?: IconTypeId }

/**
 * 一组图标占用的格子总数(顶层行,每图标按类型格数 w×h)。
 * 传入的 icons 应已限定到单个页面（调用方负责按 pageId 过滤)。
 * 分组语义(ADR-0011):只计页面**顶层**行——parentId 非空的组内成员不计容量,
 * 对齐后端 IconService.cellsUsed。
 */
export function cellsUsed(icons: ReadonlyArray<PageIcon>): number {
  let sum = 0
  for (const i of icons) {
    if (i.parentId != null) continue
    sum += iconCells(i.type)
  }
  return sum
}

/** 页面容量 = 列数 × 行数（见 CONTEXT.md「页面容量」）。 */
export function capacityFor(cols: number, rows: number): number {
  return cols * rows
}

/**
 * 目标页能否再容纳待放入图标:addCells = 其类型格数(缺省 1)。
 * 已用 + addCells ≤ 容量（对齐后端 requireCapacity「needed > remaining → 拒绝」）。
 */
export function canFit(icons: ReadonlyArray<PageIcon>, capacity: number, addCells = 1): boolean {
  return cellsUsed(icons) + addCells <= capacity
}
