import { createContext, useContext, type ReactNode } from 'react'
import { DEFAULT_LAYOUT_SETTINGS, withDefaults } from '../lib/layoutSettings'
import type { LayoutSettings } from '../lib/types'

/**
 * 布局设置上下文(见 CONTEXT.md「布局设置」)。Dashboard 据聚合接口的 layoutSettings
 * (叠加 SettingsDrawer 的乐观预览)注入,IconGrid(宽/间距)与 Icon(缩放)消费。
 * value 缺省时 withDefaults 兜底默认值(1024/8/1.0)。
 */
const LayoutSettingsContext = createContext<LayoutSettings>(DEFAULT_LAYOUT_SETTINGS)

export function LayoutSettingsProvider({
  value,
  children,
}: {
  value: LayoutSettings | null | undefined
  children: ReactNode
}) {
  return (
    <LayoutSettingsContext.Provider value={withDefaults(value)}>
      {children}
    </LayoutSettingsContext.Provider>
  )
}

export function useLayoutSettings(): LayoutSettings {
  return useContext(LayoutSettingsContext)
}
