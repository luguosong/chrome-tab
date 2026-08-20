import { createContext, useCallback, useContext, useRef, useState } from 'react'
import type { Icon } from '../lib/types'
import { useEditMode } from './EditModeContext'

/**
 * 分组合并手势(ADR-0011 建组手势 / issue 07)。
 *
 * 编辑模式拖 A 悬停到 B(同起点页的顶层 nav 或组)达 dwell 阈值后,B 获得放大反馈
 * (iOS 文件夹手感);null = 无达标目标(悬停未达阈值 / 已拖离 / 松手)。
 * dwell 计时与目标状态收在 {@link useGroupGestureDwell},经 GroupGestureContext
 * 下发到 Icon 作视觉反馈——context 而非 props,免去四层透传。
 */
export const GroupGestureContext = createContext<number | null>(null)

export function useGroupGesture() {
  return useContext(GroupGestureContext)
}

/** dwell 阈值(ms):悬停达标放大反馈,手感向 iOS 文件夹看齐(票 07 自调参项)。 */
const DWELL_MS = 450

/**
 * 合并手势 dwell 计时。dnd-kit 的 onDragOver **只在 over 变化时触发**,悬停期间
 * 不连续调用——故计时在每次 over 变化时启停,达标由 setTimeout 置位:
 *
 * 编辑模式拖 A(nav 顶层)悬停到与 A **同起点页**的顶层 nav/组上持续 DWELL_MS →
 * 目标放大,松手改走 merge/入组而非排序。判定要点:
 * - 同页用**起点页**(dragStart 快照的 pageId):onDragOver 的跨页乐观移动只写缓存,
 *   服务端未动,悬停跨页目标时 merge 必 409,故直接不给反馈;
 * - 组被拖不 eligible(dragged 须 nav)→ 不计时,普通排序落下;
 * - 悬停对象变化即重置计时并熄灭旧反馈;调用方在 onDragEnd/onDragCancel 调 clearDwell。
 */
export function useGroupGestureDwell() {
  const { editing } = useEditMode()
  const [dwellTargetId, setDwellTargetId] = useState<number | null>(null)
  const timerRef = useRef<number | null>(null)

  const clearDwell = useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    setDwellTargetId((cur) => (cur === null ? cur : null))
  }, [])

  /**
   * onDragOver 里的 dwell 计时(icons/dragged 传当前聚合缓存值,勿用 render 闭包旧值)。
   * @param startPageId 拖拽起点页(dragStart 快照里被拖项的 pageId)
   * @param overIsPage  over 是否页级 droppable(空页落点,恒不 eligible)
   */
  const updateDwell = useCallback(
    (
      dragged: Icon,
      startPageId: number,
      overId: number,
      overIsPage: boolean,
      icons: readonly Icon[],
    ) => {
      if (!editing) return
      const target = overIsPage ? null : icons.find((i) => i.id === overId) ?? null
      const eligible =
        dragged.type === 'nav' &&
        dragged.parentId === null &&
        target != null &&
        target.id !== dragged.id &&
        target.parentId === null &&
        target.pageId === startPageId && // 跨页目标禁判:乐观移动未持久化,merge 必 409
        (target.type === 'nav' || target.type === 'group') // 目标可为组(入组同一手势)
      if (!eligible) {
        clearDwell()
        return
      }
      if (dwellTargetId === overId) return // 已达标且未换目标,保持
      if (timerRef.current != null) window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null
        setDwellTargetId(overId)
      }, DWELL_MS)
      if (dwellTargetId !== null) setDwellTargetId(null) // 换目标先熄灭旧反馈,重新计时
    },
    [editing, clearDwell, dwellTargetId],
  )

  return { dwellTargetId, clearDwell, updateDwell }
}
