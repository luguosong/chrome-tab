/**
 * 拖拽会话的接线 hook(CONTEXT.md「拖拽编排」):把 lib/dragSession 的纯状态机
 * 接到 DndContext 事件上,并执行其输出的 Effect(写 ['config'] 缓存 / 快照回滚 /
 * mutate 提交 / notice 计时 / dwell 计时)。策略与协议在 lib 层(决策 iconDrag +
 * 会话 dragSession,均有表驱动测试);本 hook 只做「事件 → env 拉取 → reducer →
 * 执行」,不含可测逻辑(ADR-0040 §3:不引入组件测试设施)。
 *
 * DashboardPage 的拖拽接线只剩:绑四个 handler 到 DndContext、渲染 activeIcon
 * 幽灵与 notice、经 GroupGestureContext 下发 dwellTargetId。openGroupId 留在
 * 页面(非拖拽生命周期:点组也开),关闭经 onCloseOverlay 回调上抛。
 */
import { useCallback, useRef, useState } from 'react'
import type { DragEndEvent, DragOverEvent, DragStartEvent } from '@dnd-kit/core'
import { useQueryClient } from '@tanstack/react-query'
import { CONFIG_KEY, useConfig, useMergeIcons, useMoveIcon } from '../api/config'
import { ApiError } from '../api/client'
import { useEditMode } from '../context/EditModeContext'
import {
  IDLE,
  dragSessionEvent,
  type DragSessionEffect,
  type DragSessionState,
} from '../lib/dragSession'
import { parseOver } from '../lib/iconDrag'
import type { Config, Icon } from '../lib/types'

/** dwell 阈值(ms):悬停达标放大反馈,手感向 iOS 文件夹看齐(票 07 自调参项)。 */
const DWELL_MS = 450
/** notice 自动消失时长(ms)。 */
const NOTICE_MS = 1800

export function useDragSession({
  openGroupId,
  onCloseOverlay,
}: {
  openGroupId: number | null
  onCloseOverlay: () => void
}) {
  const { editing } = useEditMode()
  const { data } = useConfig()
  const qc = useQueryClient()
  const moveIconMut = useMoveIcon()
  const mergeMut = useMergeIcons()

  // 会话态走 ref 镜像:高频 onDragOver 事件之间同步读最新值,不赌 setState 异步。
  const [session, setSession] = useState<DragSessionState>(IDLE)
  const sessionRef = useRef(session)
  // 拖拽幽灵数据源(渲染派生;useConfig 同 key 共享缓存,不重复请求)。
  const icons = data?.icons ?? []
  const activeIcon = session.activeId != null ? icons.find((i) => i.id === session.activeId) ?? null : null

  // ── dwell 计时(原 useGroupGestureDwell 收编;编辑门已在决策层,此处纯计时)──
  const [dwellTargetId, setDwellTargetId] = useState<number | null>(null)
  const dwellRef = useRef<number | null>(null)
  const dwellTimerRef = useRef<number | null>(null)
  const clearDwell = useCallback(() => {
    if (dwellTimerRef.current != null) {
      window.clearTimeout(dwellTimerRef.current)
      dwellTimerRef.current = null
    }
    if (dwellRef.current !== null) {
      dwellRef.current = null
      setDwellTargetId(null)
    }
  }, [])
  /** 观察悬停:dnd-kit 只在 over 变化时触发,计时随启停,达标由 setTimeout 置位。
   *  编辑门在决策层(查看态不发 dwellObserve);此处持手势合格性(eligible)判定,
   *  icons 用 effect 携带的转译时刻快照,不再拉缓存。 */
  const observeDwell = useCallback(
    (dragged: Icon, startPageId: number, overId: number, overIsPage: boolean, icons: readonly Icon[]) => {
      const target = overIsPage ? null : icons.find((i) => i.id === overId) ?? null
      const eligible =
        dragged.type === 'nav' &&
        dragged.parentId === null &&
        target != null &&
        target.id !== dragged.id &&
        target.parentId === null &&
        target.pageId === startPageId && // 跨页目标禁判:乐观移动未持久化,merge 必 409
        (target.type === 'nav' || target.type === 'group') // 目标可为组(入组同一手势)
      if (!eligible) return clearDwell()
      if (dwellRef.current === overId) return // 已达标且未换目标,保持
      if (dwellTimerRef.current != null) window.clearTimeout(dwellTimerRef.current)
      dwellTimerRef.current = window.setTimeout(() => {
        dwellTimerRef.current = null
        dwellRef.current = overId
        setDwellTargetId(overId)
      }, DWELL_MS)
      if (dwellRef.current !== null) {
        dwellRef.current = null // 换目标先熄灭旧反馈,重新计时
        setDwellTargetId(null)
      }
    },
    [clearDwell],
  )

  // ── notice(容量拒绝等短暂提示;同值 setState bail-out 不抖,末次后 1.8s 清)──
  const [notice, setNotice] = useState<string | null>(null)
  const noticeTimerRef = useRef<number | null>(null)
  const showNotice = useCallback((message: string) => {
    setNotice(message)
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current)
    noticeTimerRef.current = window.setTimeout(() => setNotice(null), NOTICE_MS)
  }, [])

  // ── Effect 执行(协议知识的单点:缓存怎么写、mutate 怎么发)──────────────────
  const runEffects = useCallback(
    (effects: DragSessionEffect[]) => {
      for (const eff of effects) {
        switch (eff.kind) {
          case 'cacheIcons':
            qc.setQueryData<Config>(CONFIG_KEY, (prev) =>
              prev ? { ...prev, icons: eff.icons } : prev,
            )
            break
          case 'restoreSnapshot':
            qc.setQueryData<Config>(CONFIG_KEY, eff.config)
            break
          case 'dwellClear':
            clearDwell()
            break
          case 'dwellObserve':
            observeDwell(eff.dragged, eff.startPageId, eff.overId, eff.overIsPage, eff.icons)
            break
          case 'notice':
            showNotice(eff.message)
            break
          case 'closeOverlay':
            onCloseOverlay()
            break
          case 'commitIntoGroup':
            // 入组 wire:后端忽略 toIndex、恒落组内末尾
            moveIconMut.mutate(
              { id: eff.id, toPageId: eff.toPageId, toIndex: 0, parentId: eff.groupId },
              { onError: (err) => showNotice(err instanceof ApiError ? err.message : '加入分组失败') },
            )
            break
          case 'commitMergeGroup':
            // 建组 wire:memberIds 有序 = [被拖 A, 悬停目标 B],组行继承 B 位
            mergeMut.mutate(
              { pageId: eff.pageId, memberIds: eff.memberIds },
              { onError: (err) => showNotice(err instanceof ApiError ? err.message : '创建分组失败') },
            )
            break
          case 'commitMove':
            // 失败不回滚提示:useMoveIcon onSettled invalidate 兜底自愈(06/07 既有约定)
            moveIconMut.mutate(
              eff.parentId != null
                ? { id: eff.id, toPageId: eff.toPageId, toIndex: eff.toIndex, parentId: eff.parentId }
                : { id: eff.id, toPageId: eff.toPageId, toIndex: eff.toIndex },
            )
            break
        }
      }
    },
    [qc, clearDwell, observeDwell, showNotice, onCloseOverlay, moveIconMut, mergeMut],
  )

  /** 事件统一入口:拉 env(事件时刻缓存,新鲜度契约)→ reducer → 执行。 */
  const apply = useCallback(
    (event: Parameters<typeof dragSessionEvent>[1]) => {
      const env = {
        cacheConfig: qc.getQueryData<Config>(CONFIG_KEY) ?? null,
        editing,
        openGroupId,
      }
      const result = dragSessionEvent(sessionRef.current, event, env)
      sessionRef.current = result.state
      setSession(result.state)
      runEffects(result.effects)
    },
    [qc, editing, openGroupId, runEffects],
  )

  const onDragStart = useCallback(
    (e: DragStartEvent) => apply({ type: 'start', activeId: Number(e.active.id) || null }),
    [apply],
  )
  const onDragOver = useCallback(
    (e: DragOverEvent) =>
      apply({ type: 'over', over: parseOver(e.over), draggedId: Number(e.active.id) }),
    [apply],
  )
  const onDragEnd = useCallback(
    (e: DragEndEvent) =>
      apply({
        type: 'end',
        over: parseOver(e.over),
        draggedId: Number(e.active.id),
        dwellTargetId: dwellRef.current,
      }),
    [apply],
  )
  const onDragCancel = useCallback(() => apply({ type: 'cancel' }), [apply])

  return { onDragStart, onDragOver, onDragEnd, onDragCancel, activeIcon, dwellTargetId, notice }
}
