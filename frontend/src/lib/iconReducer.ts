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
 * 入组语义(parentId 非空)不在本 reducer:入组恒落组内末尾、源页补洞,
 * 由 groupReducer.moveIntoGroup 承载(ADR-0011),useMoveIcon.onMutate 按 parentId 分派。
 *
 * 序列语义(ADR-0011):页面序列只含顶层行(parentId==null);组内成员不参与
 * toIndex 定位与重排——后端 topLevel 查询同义,invalidate 后两者一致。
 *
 * @param icons   当前全部图标(跨页)
 * @param action  { id, toPageId, toIndex } —— toIndex 为目标页内位序(0..n)
 */
export function moveIcon(icons: readonly Icon[], action: MoveAction): Icon[] {
  const { id, toPageId, toIndex } = action
  const moving = icons.find((i) => i.id === id)
  if (!moving) return [...icons]

  // 目标页顶层图标(剔除被移动项;组内成员不参与页面序列)按 sortOrder 升序,
  // 在 toIndex 插入,重算 0..n-1。被移项恒清 parentId(镜像后端 move 分支三
  // setParentId(null)):组内成员经本 reducer 落页面序列 = move-out 乐观转移。
  const targetList = icons
    .filter((i) => i.pageId === toPageId && i.parentId === null && i.id !== id)
    .sort((a, b) => a.sortOrder - b.sortOrder)
  const insertAt = Math.max(0, Math.min(toIndex, targetList.length))
  targetList.splice(insertAt, 0, { ...moving, pageId: toPageId, parentId: null })

  const order = new Map(targetList.map((i, idx) => [i.id, idx]))

  // 同页:仅目标页(== 源页)图标重算 sortOrder。跨页(07):被移动项 pageId 变更,
  // 目标页重排;源页序号留待 onSettled invalidate 后由服务端权威数据补齐。
  // move-out 的源组行留待 invalidate(源组变空由服务端删,乐观瞬态可见空组,对齐
  // 「源页序号留洞」的同款预期,见测试注释)。
  return icons.map((i) =>
    order.has(i.id)
      ? { ...i, pageId: toPageId, parentId: null, sortOrder: order.get(i.id)! }
      : i,
  )
}
