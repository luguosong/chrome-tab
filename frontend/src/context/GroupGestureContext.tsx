import { createContext, useContext } from 'react'

/**
 * 分组合并手势(ADR-0011 建组手势 / issue 07)。
 *
 * 编辑模式拖 A 悬停到 B(同起点页的顶层 nav 或组)达 dwell 阈值后,B 获得放大反馈
 * (iOS 文件夹手感);null = 无达标目标(悬停未达阈值 / 已拖离 / 松手)。
 *
 * dwell 计时与目标状态收在拖拽会话(hooks/useDragSession,决策与编辑门在
 * lib/iconDrag + lib/dragSession);本文件只承载反馈值的下发——context 而非
 * props,免去四层透传。
 */
export const GroupGestureContext = createContext<number | null>(null)

export function useGroupGesture() {
  return useContext(GroupGestureContext)
}
