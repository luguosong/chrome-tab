import type { IconSize } from './types'

/**
 * 图标尺寸 → 网格格子(col × row),见 CONTEXT.md「尺寸」。
 * 6 列网格:small=1×1 / medium=2×2 / large=3×2。IconGrid 用此映射算 grid span。
 * 容量校验相关的 cellsUsed/capacityFor 属于 05/09 ticket,这里不导出。
 */
export const SIZE_CELLS: Record<IconSize, { cols: number; rows: number }> = {
  small: { cols: 1, rows: 1 },
  medium: { cols: 2, rows: 2 },
  large: { cols: 3, rows: 2 },
}

/** 网格列数(桌面端 6 列,见 CONTEXT.md「格子」)。 */
export const GRID_COLUMNS = 6
