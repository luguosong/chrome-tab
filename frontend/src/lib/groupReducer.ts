import type { Icon } from './types'

/**
 * 分组状态转移纯 reducer(ADR-0011 / issue 07,接缝 2 同 iconReducer)。
 *
 * 与后端 IconService 的 merge / dissolve / move(parentId 分支)逐分支镜像:
 * mutation 的 onMutate 用这里算乐观态,onSettled invalidate 拉回权威数据后
 * 两者一致,UI 不二次跳动。DOM-free,可直接 Vitest 断言。
 */

/** 页内顶层序列(parentId==null,按 sortOrder 升序)——「页面序列」的单一形状
 *  (ADR-0011:组内成员不参与),reducer 与 DashboardPage 共用,免各处手写过滤漂移。 */
export function topLevelOf(icons: readonly Icon[], pageId: number): Icon[] {
  return icons
    .filter((i) => i.pageId === pageId && i.parentId === null)
    .sort((a, b) => a.sortOrder - b.sortOrder)
}

/** 建组动作。memberIds 有序:首位 = 被拖图标 A、末位 = 悬停目标 B(组行继承其位序);
 *  groupId 由调用方给——乐观更新传负数临时 id,invalidate 后由服务端真 id 替换。 */
export type MergeAction = { pageId: number; memberIds: number[]; groupId: number }

/**
 * 建组(镜像 IconService.merge):组行(type='group'/data={name})落在
 * 末位成员 B 的顶层位序上,其余成员脱离页面序列,页面重排 0..n-1;成员挂
 * parentId=groupId、组内序按 memberIds 顺序 0..n-1。未知成员 id 原样返回(防御式)。
 */
export function mergeIcons(icons: readonly Icon[], action: MergeAction): Icon[] {
  const { pageId, memberIds, groupId } = action
  const memberSet = new Set(memberIds)
  // 顶层序列(本页):成员位置由组行接管,其余顺位补上
  const topLevel = topLevelOf(icons, pageId)
  if (!memberIds.every((id) => topLevel.some((i) => i.id === id))) return [...icons]
  const lastId = memberIds[memberIds.length - 1]

  const group: Icon = {
    id: groupId,
    pageId,
    parentId: null,
    type: 'group',
    sortOrder: 0,
    data: { name: '新建分组' },
  }
  const seq: Icon[] = []
  for (const i of topLevel) {
    if (memberSet.has(i.id)) {
      if (i.id === lastId) seq.push(group) // 组行继承 B 的位置
      // 其余成员脱离页面序列(组行占了它们的位置)
    } else {
      seq.push(i)
    }
  }
  const order = new Map(seq.map((i, idx) => [i.id, idx]))
  const memberOrder = new Map(memberIds.map((id, k) => [id, k]))

  // 组行是新增行(临时 id 不在输入里),map 追加不了——变换既有行后 concat 组行
  const groupRow: Icon = { ...group, sortOrder: order.get(groupId)! }
  return icons
    .map((i) => {
      const top = order.get(i.id)
      if (top !== undefined) return { ...i, sortOrder: top }
      const inGroup = memberOrder.get(i.id)
      if (inGroup !== undefined) return { ...i, parentId: groupId, sortOrder: inGroup }
      return i
    })
    .concat(groupRow)
}

/**
 * 解散分组(镜像 IconService.dissolve):组行删除,成员(parentId=null)按组内序
 * 自组行原顶层位序展开洒回本页,页面重排 0..n-1。
 * 组不存在 / 无成员时原样返回副本。
 */
export function dissolveGroup(icons: readonly Icon[], groupId: number): Icon[] {
  const group = icons.find((i) => i.id === groupId && i.type === 'group')
  if (!group) return [...icons]
  const members = icons
    .filter((i) => i.parentId === groupId)
    .sort((a, b) => a.sortOrder - b.sortOrder)
  if (members.length === 0) return [...icons]

  // 本页顶层序列:组行位置替换为按组内序展开的成员
  const topLevel = topLevelOf(icons, group.pageId)
  const seq: Icon[] = []
  for (const i of topLevel) {
    if (i.id === groupId) seq.push(...members)
    else seq.push(i)
  }
  const order = new Map(seq.map((i, idx) => [i.id, idx]))
  const memberIds = new Set(members.map((m) => m.id))

  return icons
    .filter((i) => i.id !== groupId)
    .map((i) =>
      memberIds.has(i.id)
        ? { ...i, parentId: null, sortOrder: order.get(i.id)! }
        : order.has(i.id)
          ? { ...i, sortOrder: order.get(i.id)! }
          : i,
    )
}

/**
 * 图标入组 / 组内重排(镜像 IconService.move 的 parentId 分支):
 * - 顶层图标入组:恒落组内序列末尾(后端忽略 toIndex);源页顶层序列补洞重排;
 *   pageId 同步为组的 pageId。
 * - 已在同组(票 08 组内重排):剔除自身后按**夹紧 toIndex** 插入,页面顶层不动。
 * - 跨组搬移:后端支持(removeFromGroup + 落目标组末尾)但 UI 无路径,原样返回副本。
 * 目标不是组时原样返回副本(后端对应分支为 409,由服务端把关)。
 */
export function moveIntoGroup(
  icons: readonly Icon[],
  action: { id: number; groupId: number; toIndex?: number },
): Icon[] {
  const { id, groupId, toIndex } = action
  const icon = icons.find((i) => i.id === id)
  const group = icons.find((i) => i.id === groupId && i.type === 'group')
  if (!icon || !group) return [...icons]
  if (icon.parentId != null && icon.parentId !== groupId) return [...icons]

  // 已在同组:组内重排(镜像后端 alreadyInside 分支——先剔除自身再按夹紧 toIndex 插入,
  // 故「拖 A 悬停 B」传 B 的绝对序会让 A 落 B 后,与 dnd-kit arrayMove 视觉一致)
  if (icon.parentId === groupId) {
    const seq = icons
      .filter((i) => i.parentId === groupId && i.id !== id)
      .sort((a, b) => a.sortOrder - b.sortOrder)
    seq.splice(Math.max(0, Math.min(toIndex ?? seq.length, seq.length)), 0, icon)
    const order = new Map(seq.map((i, k) => [i.id, k]))
    return icons.map((i) => (order.has(i.id) ? { ...i, sortOrder: order.get(i.id)! } : i))
  }

  // 源页顶层补洞(镜像后端 renumber(src))
  const src = topLevelOf(icons, icon.pageId).filter((i) => i.id !== id)
  const srcOrder = new Map(src.map((i, idx) => [i.id, idx]))
  // 组内末尾序号
  const groupMembers = icons.filter((i) => i.parentId === groupId)
  const nextOrder = groupMembers.reduce((m, i) => Math.max(m, i.sortOrder + 1), 0)

  return icons.map((i) => {
    if (i.id === id) return { ...i, parentId: groupId, pageId: group.pageId, sortOrder: nextOrder }
    const s = srcOrder.get(i.id)
    return s !== undefined ? { ...i, sortOrder: s } : i
  })
}

/** 组内成员按 sortOrder 升序(组图标 3×3 预览 / 08 票弹层渲染用派生函数)。 */
export function groupMembers(icons: readonly Icon[], groupId: number): Icon[] {
  return icons.filter((i) => i.parentId === groupId).sort((a, b) => a.sortOrder - b.sortOrder)
}

// ── 组内弹层分页(票 08,ADR-0011:9 个/页的纯展示切片,无「组内页」实体)──────

/** 组内弹层每页成员数(3×3)。 */
export const GROUP_PAGE_SIZE = 9

/** 组内弹层总页数。空组(乐观瞬态)为 0 页,由调用方按空态处理。 */
export function groupPageCount(memberCount: number): number {
  return Math.ceil(memberCount / GROUP_PAGE_SIZE)
}

/** 组内弹层第 k 页(0 基)的成员切片:`[9k, 9k+9)`;越界 / 负数页为空切片。 */
export function groupPageSlice(members: readonly Icon[], k: number): Icon[] {
  return members.slice(GROUP_PAGE_SIZE * k, GROUP_PAGE_SIZE * (k + 1))
}
