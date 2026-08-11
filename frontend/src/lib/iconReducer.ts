import type { Icon } from './types'

/**
 * 图标移动/重排纯 reducer(spec §Testing Decisions 接缝 2 / issue 06)。
 *
 * 供 DndContext 的 onDragEnd 调用:输入当前 icons 与一个移动动作,输出新的 icons
 * 数组(已重算目标页 sortOrder)。同时被 useMoveIcon 的乐观更新复用,保证「乐观态」
 * 与「服务端权威态」用同一套语义计算,避免双写偏差。
 *
 * **与后端 IconService.move 同义**:目标页先剔除被移动项,在 toIndex 插入,再按
 * 0..n-1 重排 sortOrder。这样前端乐观结果与 PATCH /api/icons/move 后服务端返回一致,
 * onSettled 的 invalidate 不会引起二次跳动。
 *
 * 本票(06)仅消费同页分支(toPageId === 被移动图标所在页);跨页分支为 07 票预留——
 * 签名已含 toPageId,07 接 onDragOver 时无需改 reducer 契约。
 */
export type MoveAction = { id: number; toPageId: number; toIndex: number }

/**
 * 把 id 标识的图标移到 toPageId 页的 toIndex 位序,返回新的 icons 数组。
 * 不修改原数组;未知 id 原样返回(防御式)。
 *
 * @param icons   当前全部图标(跨页)
 * @param action  { id, toPageId, toIndex } —— toIndex 为目标页内位序(0..n)
 */
export function moveIcon(icons: readonly Icon[], action: MoveAction): Icon[] {
  const { id, toPageId, toIndex } = action
  const moving = icons.find((i) => i.id === id)
  if (!moving) return [...icons]

  // 目标页图标(剔除被移动项)按 sortOrder 升序,在 toIndex 插入,重算 0..n-1。
  const targetList = icons
    .filter((i) => i.pageId === toPageId && i.id !== id)
    .sort((a, b) => a.sortOrder - b.sortOrder)
  const insertAt = Math.max(0, Math.min(toIndex, targetList.length))
  targetList.splice(insertAt, 0, { ...moving, pageId: toPageId })

  const order = new Map(targetList.map((i, idx) => [i.id, idx]))

  // 同页:仅目标页(== 源页)图标重算 sortOrder。跨页(07):被移动项 pageId 变更,
  // 目标页重排;源页序号留待 onSettled invalidate 后由服务端权威数据补齐。
  return icons.map((i) =>
    order.has(i.id) ? { ...i, pageId: toPageId, sortOrder: order.get(i.id)! } : i,
  )
}
