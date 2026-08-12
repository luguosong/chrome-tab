import type { LayoutSettings } from './types'

/**
 * 布局设置数值边界与默认值,镜像后端 LayoutLimits(见 layoutsetting/LayoutLimits.java)。
 * 默认值=改造前硬编码:max-w-5xl(1024px)、gap-2(8px)、scale 1.0。
 */
export const LAYOUT_LIMITS = {
  gridWidth: { min: 640, max: 1536, step: 16, default: 1024 },
  gridGap: { min: 0, max: 24, step: 1, default: 8 },
  iconScale: { min: 0.75, max: 1.5, step: 0.05, default: 1.0 },
} as const

export const DEFAULT_LAYOUT_SETTINGS: LayoutSettings = {
  gridWidth: LAYOUT_LIMITS.gridWidth.default,
  gridGap: LAYOUT_LIMITS.gridGap.default,
  iconScale: LAYOUT_LIMITS.iconScale.default,
}

/** 缺失字段补默认值;防御后端省略字段(如旧客户端读新库前的过渡)。 */
export function withDefaults(
  s: Partial<LayoutSettings> | null | undefined,
): LayoutSettings {
  return {
    gridWidth: s?.gridWidth ?? DEFAULT_LAYOUT_SETTINGS.gridWidth,
    gridGap: s?.gridGap ?? DEFAULT_LAYOUT_SETTINGS.gridGap,
    iconScale: s?.iconScale ?? DEFAULT_LAYOUT_SETTINGS.iconScale,
  }
}
