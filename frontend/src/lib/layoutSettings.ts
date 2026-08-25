import type { LayoutSettings } from './types'

/**
 * 布局设置数值边界与默认值,镜像后端 LayoutLimits(见 layoutsetting/LayoutLimits.java)。
 * 默认值=扩展前硬编码:max-w-5xl(1024px)、gap-2(8px)、scale 1.0、暗色页板 0.36、
 * 搜索框 max-w-xl(576px)、时钟 text-5xl(48px)、名称 text-xs(12px)。
 */
export const LAYOUT_LIMITS = {
  gridWidth: { min: 768, max: 1536, step: 16, default: 1024 },
  gridGap: { min: 0, max: 24, step: 1, default: 8 },
  gridGapY: { min: 0, max: 32, step: 1, default: 8 },
  iconScale: { min: 0.75, max: 2, step: 0.05, default: 1.5 },
  panelFog: { min: 0, max: 60, step: 1, default: 36 },
  searchBarWidth: { min: 320, max: 1024, step: 16, default: 576 },
  clockFont: { min: 28, max: 72, step: 2, default: 48 },
  labelSize: { min: 10, max: 16, step: 1, default: 12 },
} as const

export const DEFAULT_LAYOUT_SETTINGS: LayoutSettings = {
  gridWidth: LAYOUT_LIMITS.gridWidth.default,
  gridGap: LAYOUT_LIMITS.gridGap.default,
  gridGapY: LAYOUT_LIMITS.gridGapY.default,
  iconScale: LAYOUT_LIMITS.iconScale.default,
  panelFog: LAYOUT_LIMITS.panelFog.default,
  searchBarWidth: LAYOUT_LIMITS.searchBarWidth.default,
  searchBarVisible: true,
  searchEngine: 'google',
  clockVisible: true,
  clockFont: LAYOUT_LIMITS.clockFont.default,
  clock24h: true,
  labelVisible: true,
  labelSize: LAYOUT_LIMITS.labelSize.default,
  labelColor: '#ffffff',
  importantDates: [],
}

/** 缺失字段补默认值;防御旧后端/旧备份缺新字段的过渡期(?? 只拦 null/undefined,0/false 保留)。 */
export function withDefaults(
  s: Partial<LayoutSettings> | null | undefined,
): LayoutSettings {
  return {
    // gridWidth 下限随 9×9 扩容上调 640→768(ADR-0021):存量更低值在**读侧**钳到界内,
    // 防旧值原样回传触发后端 400。其余字段边界未动,存量必在界内,无需同款钳制。
    gridWidth: Math.min(
      LAYOUT_LIMITS.gridWidth.max,
      Math.max(LAYOUT_LIMITS.gridWidth.min, s?.gridWidth ?? DEFAULT_LAYOUT_SETTINGS.gridWidth),
    ),
    gridGap: s?.gridGap ?? DEFAULT_LAYOUT_SETTINGS.gridGap,
    gridGapY: s?.gridGapY ?? DEFAULT_LAYOUT_SETTINGS.gridGapY,
    iconScale: s?.iconScale ?? DEFAULT_LAYOUT_SETTINGS.iconScale,
    panelFog: s?.panelFog ?? DEFAULT_LAYOUT_SETTINGS.panelFog,
    searchBarWidth: s?.searchBarWidth ?? DEFAULT_LAYOUT_SETTINGS.searchBarWidth,
    searchBarVisible: s?.searchBarVisible ?? true,
    searchEngine: s?.searchEngine ?? 'google',
    clockVisible: s?.clockVisible ?? true,
    clockFont: s?.clockFont ?? DEFAULT_LAYOUT_SETTINGS.clockFont,
    clock24h: s?.clock24h ?? true,
    labelVisible: s?.labelVisible ?? true,
    labelSize: s?.labelSize ?? DEFAULT_LAYOUT_SETTINGS.labelSize,
    labelColor: s?.labelColor ?? '#ffffff',
    importantDates: s?.importantDates ?? [],
  }
}
