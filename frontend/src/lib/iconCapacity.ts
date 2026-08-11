import { SIZE_CELLS } from './iconLayout'
import type { IconSize } from './types'

/**
 * 容量约定与纯函数（对齐 ADR-0002 与 CONTEXT.md「页面容量」）。
 * 后端单一事实源：Size.cells() / DEFAULT_CAPACITY_CELLS（见 backend）。
 * 前端镜像此约定用于即时反馈（角标、新增抽屉预校验），服务端校验为最终防线。
 *
 * 三个纯函数（cellsUsed / capacityFor / canFit）对齐 spec §接缝2，DOM-free，可直接
 * Vitest 断言。组件层（角标、抽屉）只做 UI 编排，纯逻辑不进组件。
 */

/** 尺寸 → 占用格子数(cols×rows)。由 iconLayout.SIZE_CELLS 派生:网格维度单一事实源,
 *  改 grid span 时容量自动跟随,避免两处重复定义漂移(对齐后端 Size.cells() 1/4/6)。 */
export const CELLS_PER_SIZE: Record<IconSize, number> = {
  small: SIZE_CELLS.small.cols * SIZE_CELLS.small.rows,
  medium: SIZE_CELLS.medium.cols * SIZE_CELLS.medium.rows,
  large: SIZE_CELLS.large.cols * SIZE_CELLS.large.rows,
}

/** 类型定义用的尺寸字面量联合。 */
export type SizeKey = keyof typeof CELLS_PER_SIZE

/** 后端兜底默认容量（6 列 × 4 行 = 24 格）。角标以此为准：与服务端最终校验一致。 */
export const DEFAULT_PAGE_CAPACITY = 24

/** 只需 size 字段即可算容量，便于用最小对象/测试桩调用。 */
export type SizedIcon = { size: IconSize }

/**
 * 一组图标占用的格子总数（对齐后端 Size.cells() 求和）。
 * 传入的 icons 应已限定到单个页面（调用方负责按 pageId 过滤）。
 */
export function cellsUsed(icons: ReadonlyArray<SizedIcon>): number {
  let sum = 0
  for (const i of icons) sum += CELLS_PER_SIZE[i.size]
  return sum
}

/** 页面容量 = 列数 × 行数（见 CONTEXT.md「页面容量」）。 */
export function capacityFor(cols: number, rows: number): number {
  return cols * rows
}

/**
 * 目标页能否再容纳一个该尺寸的新图标：已用 + 新增 ≤ 容量
 * （对齐后端 requireCapacity「needed > remaining → 拒绝」）。
 * 注意：用于"新增"判断；改尺寸/移动时图标自身已在页内，由调用方先剔除。
 */
export function canFit(
  icons: ReadonlyArray<SizedIcon>,
  capacity: number,
  newSize: IconSize,
): boolean {
  return cellsUsed(icons) + CELLS_PER_SIZE[newSize] <= capacity
}
