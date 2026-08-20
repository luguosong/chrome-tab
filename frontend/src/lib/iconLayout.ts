/**
 * 网格几何(见 CONTEXT.md「格子」/ ADR-0016):所有图标一律占 1 格,
 * 无尺寸档位。固定 8×8 网格:列数与行数都固定,背景尺寸由网格决定而非
 * 随图标数量变化。容量 = GRID_COLUMNS × GRID_ROWS。
 */
export const GRID_COLUMNS = 8
export const GRID_ROWS = 8

/**
 * favicon 基准边长(ADR-0014 遗产,ADR-0016 单档化):32px,
 * 只随 iconScale 同比缩放,gridGap 不再参与推导。
 */
export const FAV_BASE_PX = 32

/** 裸 favicon 类型(nav / 分组)的 favicon 边长 = 基准 × iconScale。 */
export function faviconPx(iconScale = 1): number {
  return FAV_BASE_PX * iconScale
}
