/**
 * 网格几何(见 CONTEXT.md「格子」/ ADR-0016):图标默认占 1 格,类型可经注册表
 * size 声明跨格(ADR-0021,AIHOT 3×2 唯一先例)。固定 9×9 网格(2026-08-23 由 8×8
 * 扩容,为大 tile 腾格):列数与行数都固定,背景尺寸由网格决定而非随图标数量变化。
 * 容量 = GRID_COLUMNS × GRID_ROWS = 81。
 */
export const GRID_COLUMNS = 9
export const GRID_ROWS = 9

/**
 * favicon 基准边长(ADR-0014 遗产,ADR-0016 单档化;上调史见 ADR-0016 注记 2026-08-23b/c):
 * 56px——用户要求默认档再放大(23b 的 48 仍偏小)。注意 iconScale 默认 1.5(前后端
 * LayoutLimits),默认视觉 = 56×1.5 = 84px;上调对所有 scale 档位同比生效。
 * 只随 iconScale 同比缩放,gridGap 不参与推导。
 */
export const FAV_BASE_PX = 56

/** 裸 favicon 类型(nav / 分组)的 favicon 边长 = 基准 × iconScale。 */
export function faviconPx(iconScale = 1): number {
  return FAV_BASE_PX * iconScale
}

/** 分组块内边距(见 Icon.tsx GroupBody):块边 = favicon + 2×pad,是宽度钳制要预留的最坏块。 */
export const GROUP_PAD_PX = 3

/** 跨 3 列块拖拽幽灵估宽(24 = 2×列 gap 近似;BigTile 先例,Tile fill 变体同口径)。 */
export const ghostWidth3Cols = (favPx: number): number => favPx * 3 + 24

/**
 * 名称行行高与「块↔行」间距(常数同源,ADR-0016 注记 e):此前 iconLayout 硬编码
 * 镜像 Icon.tsx 样式侧的 Tailwind 默认(行高 1.5 / gap-1),改样式会静默错位——
 * 现在 IconLabel/画格(Tile.tsx)与 labelBlockPx 同引这一份导出。
 */
export const LABEL_LINE_HEIGHT = 1.5
export const LABEL_GAP_PX = 4

/**
 * 图标名称行占据的画格高度(labelSize 字号 × 行高 + 与块的 gap)。
 * 与 IconLabel 渲染口径一致(同引 LABEL_* 常数);label 隐藏时为 0。
 */
export function labelBlockPx(labelVisible: boolean, labelSize: number): number {
  return labelVisible ? Math.ceil(labelSize * LABEL_LINE_HEIGHT) + LABEL_GAP_PX : 0
}

/**
 * 「上块下字」字号档(ADR-0016 注记 e):全类型统一主行/次行两档,px 随 iconScale
 * 同比缩放、cqw 钳制块宽占比(块是 inline-size 容器,长 ticker/版本号随块收缩不
 * 溢出)。tileFont 是档位唯一公式来源(components/Tile.tsx 的 TilePrimary/
 * TileSecondary 消费)——调字号只改这一处。
 */
export const TILE_FONT_TIERS = {
  primary: { px: 14, cqw: 24 },
  secondary: { px: 12, cqw: 20 },
} as const

export type TileFontTier = keyof typeof TILE_FONT_TIERS

/** 档位字号 CSS 值:max(12px 可读下限, min(px 档 × iconScale, cqw 档))。
 *  外层 max 防 iconScale 缩小档(<1.0 合法区间)把次行压到 12px 以下——
 *  cqw 只钳上限救不了下限,labelSize 在后端有 10px 下限而此前本公式没有。 */
export function tileFont(iconScale: number, tier: TileFontTier): string {
  const { px, cqw } = TILE_FONT_TIERS[tier]
  return `max(12px, min(${px * iconScale}px, ${cqw}cqw))`
}

/**
 * 单档图标几何(ADR-0016 修订:iconScale 是图标大小的唯一调节,必须真实生效)。
 *
 * 旧行为的 bug:网格行轨道 = repeat(8, 1fr) 平分固定画布,图标本体被「画布高/8 − 名称行」
 * 钳死——矮视口下钳制值低于一切标称边长,iconScale 拉满也不动(见 scripts/scale-repro.mjs)。
 * 新模型:行高由图标推导(仅实际占用的行参与分高),图标边长 = min(标称, 轨道宽, 行可用高):
 *   - 标称 = FAV_BASE_PX × iconScale(用户唯一大小调节)
 *   - 轨道宽上限:防重叠(用户要求「整体宽度最小时图标不要重叠」)——预留分组块
 *     2×GROUP_PAD_PX,使分组最宽块也不侵入相邻画格
 *   - 行可用高:usedRows 行铺进画布 gridH 后每行分到的高度(满 8 行的矮视口才压缩,
 *     稀疏页放行标称值;压缩全体一致,整齐的本质是一致性)
 *
 * 测量缺失(trackW/gridH ≤ 0,首帧 ResizeObserver 未回报)时退化为只按标称,
 * 观察者回报后立即校正——避免首帧图标闪没。
 */
export function iconCellGeometry({
  iconScale,
  labelBlock,
  gapY,
  usedRows,
  trackW,
  gridH,
}: {
  iconScale: number
  labelBlock: number
  gapY: number
  /** 页面实际占用的行数(ceil(顶层图标数 / 8)),≥1。 */
  usedRows: number
  /** 列轨道像素宽(grid 元素实测)。 */
  trackW: number
  /** 画布像素高(grid 元素实测)。 */
  gridH: number
}): { edge: number; rowH: number } {
  const nominal = faviconPx(iconScale)
  const rows = Math.max(1, usedRows)
  // 行开销 = 名称行 + 分组块上下各 GROUP_PAD_PX(nav 块在行内居中,余量即呼吸;
  // 分组块边 = edge + 2×pad,恰好不侵入相邻画格)
  const rowOverhead = labelBlock + GROUP_PAD_PX * 2
  const widthFit = trackW > 0 ? trackW - GROUP_PAD_PX * 2 : nominal
  const heightFit =
    gridH > 0 ? (gridH - rows * rowOverhead - (rows - 1) * gapY) / rows : nominal
  // heightFit 为负(极端矮画布)时钳到 0:行高塌到开销,块不渲染,不留负尺寸
  const edge = Math.max(0, Math.min(nominal, widthFit, heightFit))
  return { edge, rowH: edge + rowOverhead }
}
