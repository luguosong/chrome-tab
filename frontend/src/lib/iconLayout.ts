import type { IconSize } from './types'

/**
 * 图标尺寸 → 网格格子(col × row),见 CONTEXT.md「尺寸」。
 * 8 列网格:small=1×1 / medium=2×2 / large=3×2。IconGrid 用此映射算 grid span。
 * 容量校验相关的 cellsUsed/capacityFor 属于 05/09 ticket,这里不导出。
 */
export const SIZE_CELLS: Record<IconSize, { cols: number; rows: number }> = {
  small: { cols: 1, rows: 1 },
  medium: { cols: 2, rows: 2 },
  large: { cols: 3, rows: 2 },
}

/**
 * 固定 8×8 网格(见 CONTEXT.md「格子」):列数与行数都固定,
 * 背景尺寸由网格决定而非随图标数量变化。容量 = GRID_COLUMNS × GRID_ROWS。
 */
export const GRID_COLUMNS = 8
export const GRID_ROWS = 8

/**
 * favicon 基准边长(ADR-0014):small 档裸 favicon 的边长 px,medium/large 由此推导。
 */
export const FAV_BASE_PX = 32

/**
 * 裸 favicon 类型(nav / 分组封面)的 favicon 边长(ADR-0014 自相似拼版):
 * fav = cols×FAV_BASE_PX + (cols−1)×gridGap —— 中图标 ≈ 两个小 favicon 紧拼(含一个 gap),
 * 大图标同理。运行时实时读 gap/iconScale,任何布局设置组合下三档推导关系保持
 * (默认 gap=8 → 32/72/112)。撞画格高度上限的收缩由 Icon.tsx 的 maxHeight + flex 承担
 * (同档位画格等高,收缩天然全体一致)。
 */
export function faviconPx(size: IconSize, gridGap: number, iconScale = 1): number {
  const cols = SIZE_CELLS[size].cols
  return (cols * FAV_BASE_PX + (cols - 1) * gridGap) * iconScale
}
