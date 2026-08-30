/**
 * 拖拽编排(拖拽期间乐观缓存流的协议)——CONTEXT.md「拖拽编排」的实现载体。
 *
 * DashboardPage 的拖拽策略(跨页乐观搬移、容量门、组员移出、dwell 建组/入组、
 * 弹层开关判定、快照回滚)的**纯决策**单点:输入纯数据 ctx,输出 Action 列表,
 * 由 DashboardPage 接线层执行(写 ['config'] 缓存 / mutate / 提示 / dwell hook)。
 * DOM-free、零 @dnd-kit 依赖(决策 interface 只吃纯数据),可直接 Vitest 表驱动断言
 * (iconDrag.test.ts 逐用例映射提取源行号)。
 *
 * 协议约定(隐式数据约定)同样单点于此:
 * - {@link EDGE_DROP_ID}:边缘翻页 droppable 的 id(原 Carousel 持有,Carousel re-export);
 * - `group-{id}` 弹层容器 id 约定(groupContainerId / isGroupContainerId /
 *   parseGroupContainerId,原 GroupOverlay 持有,GroupOverlay 改为消费方);
 * - {@link parseOver}:把 dnd-kit 的 over 事件解析成纯数据 adapter(其本上是
 *   上述约定 + sortable.containerId 的唯一读入方);
 * - {@link collisionDetection}:ADR-0003 碰撞链(pointerWithin → rectIntersection →
 *   closestCorners 兜底)。唯一 import @dnd-kit 的成员——其 interface 本就是 dnd-kit 的。
 *
 * 行为约束:本模块由 DashboardPage 机械提取而来,对现存全部 droppable 形状
 * (sortable 项 / 空页 PageDropArea / 边缘 EdgeDropZone)行为零变化——容量门的
 * 参数差异(组员移出不带被拖格数:组员恒 1 格;空页/跨页带 iconCells)与空页
 * 分支的目标页过滤不剔组内成员(靠 canFit 内部 cellsUsed 兜住)均为现状语义,
 * 不得「顺手归一」。已知刻意偏差一处:自落守卫按数值比 id——图标 id 与页
 * droppable 的字符串 id 数值相撞时,旧实现会多发一次自位 no-op PATCH,新实现
 * 直接早退(结果等价,省一次冗余提交)。
 */
import {
  closestCorners,
  pointerWithin,
  rectIntersection,
  type CollisionDetection,
} from '@dnd-kit/core'
import type { Icon } from './types'
import { canFit, DEFAULT_PAGE_CAPACITY } from './iconCapacity'
import { iconCells } from './iconTypeRegistry'
import { groupMembers, topLevelOf } from './groupReducer'

// ── 协议约定 ───────────────────────────────────────────────────────────────

/**
 * 边缘翻页 droppable 的 id(07)。EdgeDropZone(见 Carousel)以此注册,
 * parseOver 据此识别「落在边缘」并放行(边缘翻页由 EdgeDropZone 自管计时器,
 * 不走跨页移动逻辑)。集中常量避免两处字面量漂移。
 */
export const EDGE_DROP_ID = {
  left: 'edge-left',
  right: 'edge-right',
} as const

/** 弹层 SortableContext 的容器 id:`group-{组id}`(前缀与页 id 纯数字串区分)。 */
export function groupContainerId(groupId: number): string {
  return `group-${groupId}`
}

/** 容器 id 是否属于组弹层(与 {@link groupContainerId} 同源,防前缀两处手写漂移)。 */
function isGroupContainerId(containerId: string): boolean {
  return containerId.startsWith('group-')
}

/** 容器 id → 组 id;非弹层容器返回 null(与 {@link groupContainerId} 同源)。 */
function parseGroupContainerId(containerId: string): number | null {
  return isGroupContainerId(containerId)
    ? Number(containerId.slice('group-'.length))
    : null
}

// ── parseOver:over 事件解析 adapter ───────────────────────────────────────

/** dnd-kit over 事件的最小形状(结构化收窄,不 import @dnd-kit 类型)。 */
export type OverLike = {
  id: unknown
  data?: {
    current?: { type?: unknown; pageId?: unknown; sortable?: { containerId?: unknown } } | null
  } | null
} | null | undefined

/**
 * over 落点的纯数据形状。numericOverId = Number(over.id)(droppable id 数值化,
 * NaN 语义保留给调用方比较——NaN 比较恒 false 与现状一致);none/edge 恒 null。
 */
export type OverTarget =
  | { kind: 'none'; numericOverId: null }
  | { kind: 'edge'; numericOverId: null }
  | { kind: 'groupOverlay'; groupId: number; numericOverId: number }
  | { kind: 'page'; pageId: number; numericOverId: number }
  | { kind: 'icon'; pageId: number | null; numericOverId: number }

/**
 * 解析 dnd-kit 的 over 事件为纯数据落点(判定顺序与提取源一致:弹层容器优先于
 * 空页判定):空 → none;边缘 id → edge;containerId 命中 `group-{id}` →
 * groupOverlay;data.type='page' → page(空页 droppable,PageDropArea);其余 →
 * icon(容器页 id 缺失/非数值归 null,守卫在决策内)。
 */
export function parseOver(over: OverLike): OverTarget {
  if (!over) return { kind: 'none', numericOverId: null }
  const numericOverId = Number(over.id)
  if (over.id === EDGE_DROP_ID.left || over.id === EDGE_DROP_ID.right) {
    return { kind: 'edge', numericOverId: null }
  }
  const data = over.data?.current
  const containerId = data?.sortable?.containerId
  if (typeof containerId === 'string') {
    const groupId = parseGroupContainerId(containerId)
    if (groupId != null) {
      return { kind: 'groupOverlay', groupId, numericOverId }
    }
  }
  if (data?.type === 'page') {
    return { kind: 'page', pageId: Number(data.pageId), numericOverId }
  }
  if (typeof containerId === 'string') {
    const pageId = Number(containerId)
    return {
      kind: 'icon',
      pageId: Number.isNaN(pageId) ? null : pageId,
      numericOverId,
    }
  }
  return { kind: 'icon', pageId: null, numericOverId }
}

// ── dragOverDecision:onDragOver 期间的乐观搬移决策 ─────────────────────────

export type DragOverCtx = {
  /** 当前聚合缓存的 icons(qc.getQueryData<Config>(['config']));null = 缓存未就绪 */
  icons: Icon[] | null
  /** dragStart 快照的 icons(dragSnapshotRef.current?.icons),弹层守卫与起点页判据 */
  snapshotIcons: Icon[] | null
  editing: boolean
  /** parseOver(e.over) 的解析结果 */
  over: OverTarget
  /** Number(active.id) */
  draggedId: number
}

export type DragOverAction =
  | { type: 'clearDwell' }
  | { type: 'updateDwell'; dragged: Icon; startPageId: number; overId: number; overIsPage: boolean }
  | { type: 'optimisticMove'; id: number; toPageId: number; toIndex: number }
  | { type: 'optimisticIntoGroup'; id: number; groupId: number }
  | { type: 'notice'; message: string }

/** over 空与边缘落点共用的早退动作。 */
const CLEAR_DWELL: DragOverAction = { type: 'clearDwell' }

/**
 * onDragOver 决策(由 DashboardPage.handleDragOver 机械提取):
 * 分支顺序即早退顺序——空/边缘 → 组弹层 → dwell 更新 → 组员移出 → 空页 → 跨页。
 * 返回的动作由接线层执行(写缓存 / 调 dwell hook / 提示),本函数无副作用。
 */
export function dragOverDecision(ctx: DragOverCtx): DragOverAction[] {
  const { icons, snapshotIcons, editing, over, draggedId } = ctx
  if (over.kind === 'none' || over.kind === 'edge') return [CLEAR_DWELL]
  if (!icons) return []
  const dragged = icons.find((i) => i.id === draggedId)
  if (!dragged) return []
  const actions: DragOverAction[] = []

  // ── 组弹层容器:被拖项是「本次拖拽中被乐观搬出」的组成员(dragStart 快照
  //    parentId=该组且当前已在顶层)→ 乐观搬回组;快照守卫同时防普通网格图标
  //    误入组(入组走 dwell 手势)并天然防渲染循环。
  if (over.kind === 'groupOverlay') {
    actions.push(CLEAR_DWELL)
    const startParentId =
      snapshotIcons?.find((i) => i.id === draggedId)?.parentId ?? null
    if (dragged.parentId == null && startParentId === over.groupId) {
      actions.push({ type: 'optimisticIntoGroup', id: draggedId, groupId: over.groupId })
    }
    return actions
  }

  // ── dwell 计时接线(编辑模式判定在 hook 内):同起点页判定防跨页 409。
  const startPageId =
    snapshotIcons?.find((i) => i.id === draggedId)?.pageId ?? dragged.pageId
  const overIsPage = over.kind === 'page'
  actions.push({
    type: 'updateDwell',
    dragged,
    startPageId,
    overId: over.numericOverId,
    overIsPage,
  })

  // ── 组成员拖出:查看态守卫(移出仅编辑模式),编辑态容量门(组员恒 1 格,
  //    不带被拖格数)后落 over 位序。
  if (dragged.parentId != null && !editing) {
    actions.push({ type: 'notice', message: '移出分组需先右键进入编辑模式' })
    return actions
  }
  if (dragged.parentId != null) {
    const targetPageId = over.pageId
    if (targetPageId == null) return actions
    // 落点位序:over 项在目标页顶层序列(topLevelOf 的同一形状)中的位序,非成员追加末尾
    const seq = topLevelOf(icons, targetPageId)
    if (!canFit(seq, DEFAULT_PAGE_CAPACITY)) {
      actions.push({ type: 'notice', message: '目标页已满,无法移出' })
      return actions
    }
    const idx = seq.findIndex((i) => i.id === over.numericOverId)
    actions.push({
      type: 'optimisticMove',
      id: draggedId,
      toPageId: targetPageId,
      toIndex: idx === -1 ? seq.length : idx,
    })
    return actions
  }

  // ── 空页落点:命中即位序 0 移入;容量门带被拖格数(ADR-0021)。
  if (over.kind === 'page') {
    const targetPageId = over.pageId
    if (targetPageId === dragged.pageId) return actions
    // 现状差异(空页分支):此处过滤不剔除组内成员,正确性由 canFit 内部
    // cellsUsed 跳过成员兜住——勿「顺手归一」。
    const targetIcons = icons.filter((i) => i.pageId === targetPageId)
    if (!canFit(targetIcons, DEFAULT_PAGE_CAPACITY, iconCells(dragged.type))) {
      actions.push({ type: 'notice', message: '目标页已满,无法移入' })
      return actions
    }
    actions.push({ type: 'optimisticMove', id: draggedId, toPageId: targetPageId, toIndex: 0 })
    return actions
  }

  // ── 跨页(图标落点):容器页 id 缺失(parseOver 已把 NaN 归 null)或同页早退;
  //    落点位序按目标页顶层序列(组内成员不参与页面序列,ADR-0011),非成员追加末尾;
  //    容量门带被拖格数。
  const targetPageId = over.pageId
  if (targetPageId == null || targetPageId === dragged.pageId) return actions
  const seq = topLevelOf(icons, targetPageId)
  if (!canFit(seq, DEFAULT_PAGE_CAPACITY, iconCells(dragged.type))) {
    actions.push({ type: 'notice', message: '目标页已满,无法移入' })
    return actions
  }
  const idx = seq.findIndex((i) => i.id === over.numericOverId)
  actions.push({
    type: 'optimisticMove',
    id: draggedId,
    toPageId: targetPageId,
    toIndex: idx === -1 ? seq.length : idx,
  })
  return actions
}

// ── dragEndDecision:onDragEnd 的提交/回滚/弹层判定决策 ─────────────────────

export type DragEndCtx = {
  /** 拖拽终点缓存 icons(接线层:缓存缺失时回落 useConfig 数据) */
  icons: Icon[]
  /** dragStart 快照的 icons;null = 快照缺失(前置守卫直接空动作) */
  snapshotIcons: Icon[] | null
  /** parseOver(e.over) 的解析结果 */
  over: OverTarget
  draggedId: number
  /** 达标的 dwell 目标(useGroupGestureDwell),null = 未达标 */
  dwellTargetId: number | null
  /** 打开中的分组弹层组行 id,null = 无 */
  openGroupId: number | null
}

export type DragEndAction =
  | { type: 'clearDwell' }
  /** 入组提交:接线层 mutate moveIcon({toIndex: 0, parentId: groupId}),后端忽略 toIndex */
  | { type: 'commitIntoGroup'; id: number; toPageId: number; groupId: number }
  /** 建组提交:memberIds 有序 = [被拖 A, 悬停目标 B],组行继承 B 位 */
  | { type: 'commitMergeGroup'; pageId: number; memberIds: number[] }
  /** 整份回写 dragStart 快照,撤销 onDragOver 期间的乐观写入 */
  | { type: 'rollback' }
  /** 关闭分组弹层 */
  | { type: 'closeOverlay' }
  /** 持久化提交(接线层 mutate useMoveIcon;parentId 缺省 = 顶层移动) */
  | { type: 'commitMove'; id: number; toPageId: number; toIndex: number; parentId?: number }

/**
 * onDragEnd 决策(由 DashboardPage.handleDragEnd 机械提取):
 * dwell 收尾(达标且指针仍在目标才建组/入组)→ 弹层回滚 → 组内重排 → 弹层关闭
 * 判定 → 跨页提交(缓存已是最终态)→ 同页落点提交。注意弹层关闭与后续提交可同发。
 */
export function dragEndDecision(ctx: DragEndCtx): DragEndAction[] {
  const { icons, snapshotIcons, over, draggedId, dwellTargetId, openGroupId } = ctx
  const current = icons.find((i) => i.id === draggedId)
  const startIcon = snapshotIcons?.find((i) => i.id === draggedId) ?? null
  if (!current || !startIcon) return []
  const actions: DragEndAction[] = []

  // ── dwell 收尾:达标**且指针仍停在目标上**才建组/入组;达标后又拖离则熄灭
  //    反馈、落回下方排序/移动逻辑。clearDwell 无条件(达标与否都要熄)。
  if (dwellTargetId != null) {
    const dwellOver = over.numericOverId != null && over.numericOverId === dwellTargetId
    const target = icons.find((i) => i.id === dwellTargetId) ?? null
    actions.push({ type: 'clearDwell' })
    if (dwellOver && target) {
      if (target.type === 'group') {
        actions.push({
          type: 'commitIntoGroup',
          id: draggedId,
          toPageId: target.pageId,
          groupId: target.id,
        })
      } else {
        actions.push({
          type: 'commitMergeGroup',
          pageId: target.pageId,
          memberIds: [draggedId, target.id],
        })
      }
      return actions
    }
  }

  // ── 弹层拖拽收尾:拖出后未落在页面网格(落回弹层/落空)→ 整份回写快照,
  //    撤销乐观 move-out(不持久化,不留幻影)。「落在页面网格」= 页 droppable,
  //    或容器 id 为页 id 数字串的 sortable 项——containerId 缺失/非数值的落点
  //    (如未来无 data 的裸 droppable)不算,组员拖出后落它走回滚(提取源同义)。
  const overOnPageGrid = over.kind === 'page' || (over.kind === 'icon' && over.pageId != null)
  if (startIcon.parentId != null && current.parentId == null && !overOnPageGrid) {
    actions.push({ type: 'rollback' })
    return actions
  }

  // ── 组内重排:起终同组(未拖出)——toIndex = over 项在组内全序列的绝对位序
  //    (后端 alreadyInside 分支剔除自身后夹紧插入,镜像 moveIntoGroup)。
  if (current.parentId != null && startIcon.parentId === current.parentId) {
    if (over.kind === 'none' || over.numericOverId === draggedId) return actions
    const overIdx = groupMembers(icons, current.parentId).findIndex(
      (i) => i.id === over.numericOverId,
    )
    if (overIdx === -1) return actions
    actions.push({
      type: 'commitMove',
      id: draggedId,
      toPageId: current.pageId,
      toIndex: overIdx,
      parentId: current.parentId,
    })
    return actions
  }

  // ── 弹层关闭判定:被拖项确已脱离组(落页面网格)才关;组内重排/回滚均保持
  //    开——拖拽中途绝不卸载弹层。与下方跨页/同页提交可同发。
  if (
    openGroupId != null &&
    startIcon.parentId === openGroupId &&
    current.parentId == null &&
    overOnPageGrid
  ) {
    actions.push({ type: 'closeOverlay' })
  }

  // ── 跨页:缓存已是最终态(onDragOver 已写入),按当前 (pageId, sortOrder) 提交。
  if (current.pageId !== startIcon.pageId) {
    actions.push({
      type: 'commitMove',
      id: draggedId,
      toPageId: current.pageId,
      toIndex: current.sortOrder,
    })
    return actions
  }

  // ── 同页:缓存未在拖拽中改过(视觉由 dnd-kit transform 负责),按 over 落点提交。
  //    落点位序按顶层序列解释(组内成员不参与,ADR-0011)。
  if (over.kind === 'none' || over.numericOverId === draggedId) return actions
  const overIdx = topLevelOf(icons, current.pageId).findIndex((i) => i.id === over.numericOverId)
  if (overIdx === -1) return actions
  actions.push({ type: 'commitMove', id: draggedId, toPageId: current.pageId, toIndex: overIdx })
  return actions
}

// ── collisionDetection:ADR-0003 碰撞链 ────────────────────────────────────

/**
 * 多尺寸 grid 的碰撞检测自定义 fallback 链(ADR-0003):
 * pointerWithin(指针落在 droppable 内)→ rectIntersection(矩形相交)→ closestCorners。
 * 默认 rectIntersection 在可滚动 + 多尺寸容器中已知异常,故套两层兜底。
 * 边缘翻页区(07)优先:光标落在左右边缘条内时让 EdgeDropZone 命中而非其下的
 * 页/图标,保证「拖到边缘持续翻页」不被空页 droppable 或图标遮挡打断。
 */
export const collisionDetection: CollisionDetection = (args) => {
  const pointer = pointerWithin(args)
  const edge = pointer.filter(
    (d) => d.id === EDGE_DROP_ID.left || d.id === EDGE_DROP_ID.right,
  )
  if (edge.length > 0) return edge
  if (pointer.length > 0) return pointer
  const rect = rectIntersection(args)
  if (rect.length > 0) return rect
  return closestCorners(args)
}
