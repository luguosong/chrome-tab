import { describe, expect, it } from 'vitest'
import {
  dissolveGroup,
  groupMembers,
  groupPageCount,
  groupPageSlice,
  mergeIcons,
  moveIntoGroup,
} from './groupReducer'
import { moveIcon } from './iconReducer'
import type { Icon, IconSize } from './types'

// 纯函数输入输出断言,无 DOM。镜像后端 IconService.merge / dissolve / move(parentId)语义。

/** 测试用图标构造器。parentId 非空 = 组内成员(组内 sortOrder)。 */
function icon(
  id: number,
  pageId: number,
  sortOrder: number,
  over: Partial<Icon> = {},
): Icon {
  return {
    id,
    pageId,
    parentId: null,
    type: 'nav',
    size: 'small',
    sortOrder,
    data: null,
    ...over,
  }
}

/** 组行构造器(merge 的输入里不会出现组行——组只能经 merge 诞生;此构造器用于 dissolve/moveIntoGroup 输入)。 */
function group(id: number, pageId: number, sortOrder: number): Icon {
  return icon(id, pageId, sortOrder, { type: 'group', data: { name: '新建分组' } })
}

/** 断言「页内顶层按 sortOrder 升序的 id 序列」。 */
function topLevelOf(icons: Icon[], pageId: number): number[] {
  return icons
    .filter((i) => i.pageId === pageId && i.parentId === null)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((i) => i.id)
}

const PAGE = 1

describe('mergeIcons — 建组', () => {
  it('A 拖到 B:组行落 B 位,成员按 memberIds 挂组内序,页面重排', () => {
    // 页 [A,B,C,D],拖 A 悬停 B → merge(memberIds=[A,B]);组行(临时 id -1)继承 B 的位序 1
    const icons = [
      icon(1, PAGE, 0),
      icon(2, PAGE, 1),
      icon(3, PAGE, 2),
      icon(4, PAGE, 3),
    ]
    const next = mergeIcons(icons, { pageId: PAGE, memberIds: [1, 2], groupId: -1 })
    // 顶层:A、B 都脱离页面序列,组行接 B 位 → [组,C,D]
    expect(topLevelOf(next, PAGE)).toEqual([-1, 3, 4])
    // 组行字段
    const g = next.find((i) => i.id === -1)!
    expect(g.type).toBe('group')
    expect(g.size).toBe('small')
    expect(g.data).toEqual({ name: '新建分组' })
    // 组行落在 B 的相对位置;A 在 B 前消失,renumber 后数值位序 0(对齐后端 renumber(seq))
    expect(g.sortOrder).toBe(0)
    // 成员:A、B 挂 parentId,组内序按 memberIds(0,1),size 保留
    const a = next.find((i) => i.id === 1)!
    const b = next.find((i) => i.id === 2)!
    expect(a.parentId).toBe(-1)
    expect(a.sortOrder).toBe(0)
    expect(b.parentId).toBe(-1)
    expect(b.sortOrder).toBe(1)
  })

  it('成员保留各自 size(进组不改尺寸)', () => {
    const icons = [
      icon(1, PAGE, 0, { size: 'medium' as IconSize }),
      icon(2, PAGE, 1),
    ]
    const next = mergeIcons(icons, { pageId: PAGE, memberIds: [1, 2], groupId: -1 })
    expect(next.find((i) => i.id === 1)!.size).toBe('medium')
  })

  it('悬停目标(末位)是首位的邻居前一格:位置继承语义不受距离影响', () => {
    // 页 [B,X,A],拖 A 悬停 B → 组落 B 位 0
    const icons = [icon(2, PAGE, 0), icon(3, PAGE, 1), icon(1, PAGE, 2)]
    const next = mergeIcons(icons, { pageId: PAGE, memberIds: [1, 2], groupId: -1 })
    expect(topLevelOf(next, PAGE)).toEqual([-1, 3])
  })

  it('三成员合并:memberIds 全序挂组,顶层只留组行', () => {
    const icons = [icon(1, PAGE, 0), icon(2, PAGE, 1), icon(3, PAGE, 2), icon(4, PAGE, 3)]
    const next = mergeIcons(icons, { pageId: PAGE, memberIds: [1, 3, 2], groupId: -1 })
    expect(topLevelOf(next, PAGE)).toEqual([-1, 4])
    // 组内序按 memberIds:A=0, C=1, B=2
    expect(groupMembers(next, -1).map((i) => i.id)).toEqual([1, 3, 2])
  })

  it('未知成员 id(不在本页顶层)原样返回副本——后端 409 由服务端把关', () => {
    const icons = [icon(1, PAGE, 0), icon(2, PAGE, 1)]
    const next = mergeIcons(icons, { pageId: PAGE, memberIds: [1, 999], groupId: -1 })
    expect(next).toEqual(icons)
    expect(next).not.toBe(icons)
  })

  it('已入组成员不能再参与 merge(不在顶层集)→ 原样返回', () => {
    const icons = [icon(1, PAGE, 0), icon(2, PAGE, 1, { parentId: 9 })]
    const next = mergeIcons(icons, { pageId: PAGE, memberIds: [1, 2], groupId: -1 })
    expect(next).toEqual(icons)
  })

  it('不修改原数组(不可变)', () => {
    const icons = [icon(1, PAGE, 0), icon(2, PAGE, 1)]
    const snapshot = icons.map((i) => ({ ...i }))
    mergeIcons(icons, { pageId: PAGE, memberIds: [1, 2], groupId: -1 })
    expect(icons).toEqual(snapshot)
  })
})

describe('dissolveGroup — 解散', () => {
  it('成员按组内序自组行位置洒回本页,顶层重排,组行消失', () => {
    // 页顶层 [X, 组, Y];组内成员 [A, B](A 在前)
    const icons = [
      icon(10, PAGE, 0),
      group(9, PAGE, 1),
      icon(11, PAGE, 2),
      icon(1, PAGE, 0, { parentId: 9 }),
      icon(2, PAGE, 1, { parentId: 9 }),
    ]
    const next = dissolveGroup(icons, 9)
    expect(next.find((i) => i.id === 9)).toBeUndefined()
    expect(topLevelOf(next, PAGE)).toEqual([10, 1, 2, 11])
    // 成员归顶层、保留 size
    expect(next.find((i) => i.id === 1)!.parentId).toBeNull()
    expect(next.find((i) => i.id === 2)!.parentId).toBeNull()
  })

  it('成员保留各自 size 洒回(medium 成员还原 medium)', () => {
    const icons = [
      group(9, PAGE, 0),
      icon(1, PAGE, 0, { parentId: 9, size: 'large' as IconSize }),
    ]
    const next = dissolveGroup(icons, 9)
    expect(next.find((i) => i.id === 1)!.size).toBe('large')
    expect(topLevelOf(next, PAGE)).toEqual([1])
  })

  it('非组行 id / 不存在的组 / 空组原样返回副本(空组不存活,常态不出现)', () => {
    const icons = [icon(1, PAGE, 0), group(9, PAGE, 1)]
    expect(dissolveGroup(icons, 1)).toEqual(icons)
    expect(dissolveGroup(icons, 999)).toEqual(icons)
    expect(dissolveGroup([icon(1, PAGE, 0), group(9, PAGE, 1)], 9)).toEqual([
      icon(1, PAGE, 0),
      group(9, PAGE, 1),
    ])
  })

  it('不影响其它页与其它组的成员', () => {
    const icons = [
      group(9, PAGE, 0),
      icon(1, PAGE, 0, { parentId: 9 }),
      icon(2, /*page*/ 2, 0),
      icon(3, PAGE, 5, { parentId: 8 }),
    ]
    const next = dissolveGroup(icons, 9)
    expect(next.find((i) => i.id === 2)).toEqual(icons[2])
    expect(next.find((i) => i.id === 3)!.parentId).toBe(8)
  })
})

describe('moveIntoGroup — 入组', () => {
  it('顶层图标入组:恒落组内末尾,源页补洞,pageId 同步组所在页', () => {
    // 页 [X, A, B, G(组)],组内已有成员 M;把 A 拖到组上
    const icons = [
      icon(10, PAGE, 0),
      icon(1, PAGE, 1),
      icon(2, PAGE, 2),
      group(9, PAGE, 3),
      icon(5, PAGE, 0, { parentId: 9 }),
    ]
    const next = moveIntoGroup(icons, { id: 1, groupId: 9 })
    const a = next.find((i) => i.id === 1)!
    expect(a.parentId).toBe(9)
    expect(a.sortOrder).toBe(1) // 已有 M(序 0)→ 末尾 = 1
    // 源页顶层补洞:[X, B, G] 重排 0..2
    expect(topLevelOf(next, PAGE)).toEqual([10, 2, 9])
    // 组内序 [M, A]
    expect(groupMembers(next, 9).map((i) => i.id)).toEqual([5, 1])
  })

  it('入空组(刚建的组)→ 组内序 0', () => {
    const icons = [icon(1, PAGE, 0), group(9, PAGE, 1)]
    const next = moveIntoGroup(icons, { id: 1, groupId: 9 })
    expect(groupMembers(next, 9).map((i) => i.id)).toEqual([1])
  })

  it('跨页图标入组:pageId 改为组所在页', () => {
    const icons = [icon(1, /*page*/ 2, 0), group(9, PAGE, 0)]
    const next = moveIntoGroup(icons, { id: 1, groupId: 9 })
    expect(next.find((i) => i.id === 1)!.pageId).toBe(PAGE)
  })

  it('目标是普通图标(非组行)→ 原样返回(后端 409 把关)', () => {
    const icons = [icon(1, PAGE, 0), icon(2, PAGE, 1)]
    const next = moveIntoGroup(icons, { id: 1, groupId: 2 })
    expect(next).toEqual(icons)
  })

  it('跨组搬移(后端支持、UI 无路径)→ 原样返回副本,invalidate 校正', () => {
    const icons = [
      group(9, PAGE, 0),
      group(8, PAGE, 1),
      icon(1, PAGE, 0, { parentId: 9 }),
    ]
    const next = moveIntoGroup(icons, { id: 1, groupId: 8 })
    expect(next).toEqual(icons)
  })
})

describe('moveIntoGroup — 组内重排(票 08,镜像后端 alreadyInside 分支)', () => {
  it('已在同组:剔除自身后按夹紧 toIndex 插入,页面顶层与组外不动', () => {
    // 组内 [A(0), B(1), C(2)],把 A 重排到 toIndex=2 → [B, C, A]
    const icons = [
      icon(10, PAGE, 0),
      group(9, PAGE, 1),
      icon(1, PAGE, 0, { parentId: 9 }),
      icon(2, PAGE, 1, { parentId: 9 }),
      icon(3, PAGE, 2, { parentId: 9 }),
    ]
    const next = moveIntoGroup(icons, { id: 1, groupId: 9, toIndex: 2 })
    expect(groupMembers(next, 9).map((i) => i.id)).toEqual([2, 3, 1])
    // 页面顶层 [X, 组] 不动
    expect(topLevelOf(next, PAGE)).toEqual([10, 9])
  })

  it('toIndex 超界夹紧到组内末尾(对齐后端 clamp)', () => {
    const icons = [
      group(9, PAGE, 0),
      icon(1, PAGE, 0, { parentId: 9 }),
      icon(2, PAGE, 1, { parentId: 9 }),
    ]
    const next = moveIntoGroup(icons, { id: 1, groupId: 9, toIndex: 99 })
    expect(groupMembers(next, 9).map((i) => i.id)).toEqual([2, 1])
  })

  it('toIndex 缺省(入组调用方不传)→ 已在同组视为末尾', () => {
    const icons = [
      group(9, PAGE, 0),
      icon(1, PAGE, 0, { parentId: 9 }),
      icon(2, PAGE, 1, { parentId: 9 }),
    ]
    const next = moveIntoGroup(icons, { id: 1, groupId: 9 })
    expect(groupMembers(next, 9).map((i) => i.id)).toEqual([2, 1])
  })

  it('后移一位的语义:toIndex 取 over 项在剔除后序列中的位序(active 在 over 前 → 落 over 后)', () => {
    // 组内 [A, B];拖 A 悬停 B(onDragEnd 传 toIndex = B 的绝对序 1)→ 剔除 A 后 seq=[B]
    // 插入 1 → [B, A]:A 落到 B 后,与 dnd-kit arrayMove(A→B)视觉一致
    const icons = [
      group(9, PAGE, 0),
      icon(1, PAGE, 0, { parentId: 9 }),
      icon(2, PAGE, 1, { parentId: 9 }),
    ]
    const next = moveIntoGroup(icons, { id: 1, groupId: 9, toIndex: 1 })
    expect(groupMembers(next, 9).map((i) => i.id)).toEqual([2, 1])
  })
})

describe('groupPageSlice / groupPageCount — 组内弹层分页(票 08,9 个/页展示切片)', () => {
  const membersOf = (n: number) =>
    Array.from({ length: n }, (_, k) => icon(k + 1, PAGE, k, { parentId: 9 }))
  const ids = (ms: Icon[]) => ms.map((i) => i.id)

  it('恰好 9 个:1 页,第 0 页全量、第 1 页空切片', () => {
    const members = membersOf(9)
    expect(groupPageCount(9)).toBe(1)
    expect(ids(groupPageSlice(members, 0))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(groupPageSlice(members, 1)).toEqual([])
  })

  it('10 个:2 页,第 1 页仅第 10 个', () => {
    const members = membersOf(10)
    expect(groupPageCount(10)).toBe(2)
    expect(ids(groupPageSlice(members, 1))).toEqual([10])
  })

  it('18 个:2 页,两页各 9(整除边界)', () => {
    const members = membersOf(18)
    expect(groupPageCount(18)).toBe(2)
    expect(groupPageSlice(members, 1)).toHaveLength(9)
  })

  it('19 个:3 页,第 2 页仅第 19 个', () => {
    const members = membersOf(19)
    expect(groupPageCount(19)).toBe(3)
    expect(ids(groupPageSlice(members, 2))).toEqual([19])
  })

  it('0 个:0 页(空组乐观瞬态,调用方按空态渲染)', () => {
    expect(groupPageCount(0)).toBe(0)
    expect(groupPageSlice(membersOf(0), 0)).toEqual([])
  })

  it('k 越界 / 负数:空切片不抛(UI 夹页后仍防御)', () => {
    expect(groupPageSlice(membersOf(10), 5)).toEqual([])
    expect(groupPageSlice(membersOf(10), -1)).toEqual([])
  })
})

// move-out(成员拖出落页面序列,票 07 checklist):经 moveIcon 落地即 move-out——
// 被移项恒清 parentId(镜像后端 move 分支三 setParentId(null))。源组因此变空时组行
// 的删除由服务端在事务内完成(invalidate 校正),乐观态短暂可见空组,与「源页序号
// 留洞」同款预期瞬态,不是 bug。
describe('moveIcon — move-out(成员拖出)', () => {
  it('成员落本页顶层:parentId 清空、按 toIndex 落位、保留 size,组行留存', () => {
    // 页 [X(0), 组(1)];组内 [A(0), B(1)];A 拖出到 X 前(toIndex=0)
    const icons = [
      icon(10, PAGE, 0),
      group(9, PAGE, 1),
      icon(1, PAGE, 0, { parentId: 9, size: 'medium' as IconSize }),
      icon(2, PAGE, 1, { parentId: 9 }),
    ]
    const next = moveIcon(icons, { id: 1, toPageId: PAGE, toIndex: 0 })
    const a = next.find((i) => i.id === 1)!
    expect(a.parentId).toBeNull()
    expect(a.size).toBe('medium') // 保留 size 落回,移出后按原尺寸计容量
    expect(topLevelOf(next, PAGE)).toEqual([1, 10, 9]) // A 落 0 位,组行留存(瞬态)
    // 组内剩 B,组内序不变
    expect(groupMembers(next, 9).map((i) => i.id)).toEqual([2])
  })

  it('成员跨页拖出:清 parentId 落目标页顶层', () => {
    const PAGE2 = 2
    const icons = [
      group(9, PAGE, 0),
      icon(1, PAGE, 0, { parentId: 9 }),
      icon(20, PAGE2, 0),
    ]
    const next = moveIcon(icons, { id: 1, toPageId: PAGE2, toIndex: 1 })
    const a = next.find((i) => i.id === 1)!
    expect(a.parentId).toBeNull()
    expect(a.pageId).toBe(PAGE2)
    expect(topLevelOf(next, PAGE2)).toEqual([20, 1])
  })
})

describe('groupMembers — 成员派生', () => {
  it('按 parentId 过滤 + sortOrder 升序,顶层与其它组成员不混入', () => {
    const icons = [
      group(9, PAGE, 0),
      group(8, PAGE, 1),
      icon(3, PAGE, 1, { parentId: 9 }),
      icon(1, PAGE, 0, { parentId: 9 }),
      icon(4, PAGE, 0, { parentId: 8 }),
      icon(2, PAGE, 2), // 顶层
    ]
    expect(groupMembers(icons, 9).map((i) => i.id)).toEqual([1, 3])
  })

  it('取前 9 个由调用方 slice(本函数不截断)', () => {
    const members = Array.from({ length: 12 }, (_, k) =>
      icon(k + 1, PAGE, k, { parentId: 9 }),
    )
    expect(groupMembers(members, 9)).toHaveLength(12)
  })
})
