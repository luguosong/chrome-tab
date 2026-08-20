import { describe, expect, it } from 'vitest'
import { moveIcon } from './iconReducer'
import type { Icon, IconTypeId } from './types'

// 纯函数输入输出断言,无 DOM。镜像后端 IconService.move 语义(issue 06 同页排序)。

/** 测试用图标构造器:默认 nav 顶层,sortOrder 即页内位序。 */
function icon(id: number, pageId: number, sortOrder: number, type: IconTypeId = 'nav'): Icon {
  return { id, pageId, parentId: null, type, sortOrder, data: null }
}

/** 断言「页内顶层按 sortOrder 升序的 id 序列」(组内成员不参与页面序列,ADR-0011)。 */
function orderOf(icons: Icon[], pageId: number): number[] {
  return icons
    .filter((i) => i.pageId === pageId && i.parentId === null)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((i) => i.id)
}

const PAGE = 1

describe('moveIcon — 同页排序', () => {
  it('前移到后:把首位移到 toIndex=2 → [B,C,A,D]', () => {
    // [A,B,C,D] 移 A 到 2:剔除 A 得 [B,C,D],插@2 → [B,C,A,D]
    const icons = [icon(1, PAGE, 0), icon(2, PAGE, 1), icon(3, PAGE, 2), icon(4, PAGE, 3)]
    const next = moveIcon(icons, { id: 1, toPageId: PAGE, toIndex: 2 })
    expect(orderOf(next, PAGE)).toEqual([2, 3, 1, 4])
    // sortOrder 连续 0..3
    expect(next.map((i) => i.sortOrder).sort((a, b) => a - b)).toEqual([0, 1, 2, 3])
  })

  it('后移到前:把末位移到 toIndex=0 → [D,A,B,C]', () => {
    const icons = [icon(1, PAGE, 0), icon(2, PAGE, 1), icon(3, PAGE, 2), icon(4, PAGE, 3)]
    const next = moveIcon(icons, { id: 4, toPageId: PAGE, toIndex: 0 })
    expect(orderOf(next, PAGE)).toEqual([4, 1, 2, 3])
  })

  it('移到末尾:toIndex=3 → [B,C,D,A]', () => {
    const icons = [icon(1, PAGE, 0), icon(2, PAGE, 1), icon(3, PAGE, 2), icon(4, PAGE, 3)]
    const next = moveIcon(icons, { id: 1, toPageId: PAGE, toIndex: 3 })
    expect(orderOf(next, PAGE)).toEqual([2, 3, 4, 1])
  })

  it('中间互调:把 idx1 移到 toIndex=2 → [A,C,B,D]', () => {
    const icons = [icon(1, PAGE, 0), icon(2, PAGE, 1), icon(3, PAGE, 2), icon(4, PAGE, 3)]
    const next = moveIcon(icons, { id: 2, toPageId: PAGE, toIndex: 2 })
    expect(orderOf(next, PAGE)).toEqual([1, 3, 2, 4])
  })

  it('落到自身原位(toIndex==原位序)→ 顺序不变,仅 sortOrder 归一', () => {
    // [A,B,C,D] 移 B(idx1)到 1:剔除 B 得 [A,C,D],插@1 → [A,B,C,D]
    const icons = [icon(1, PAGE, 0), icon(2, PAGE, 1), icon(3, PAGE, 2), icon(4, PAGE, 3)]
    const next = moveIcon(icons, { id: 2, toPageId: PAGE, toIndex: 1 })
    expect(orderOf(next, PAGE)).toEqual([1, 2, 3, 4])
  })
})

describe('moveIcon — 边界与不变量', () => {
  it('toIndex 超出上限被夹到末尾(对齐后端 Math.min)', () => {
    const icons = [icon(1, PAGE, 0), icon(2, PAGE, 1)]
    const next = moveIcon(icons, { id: 1, toPageId: PAGE, toIndex: 99 })
    expect(orderOf(next, PAGE)).toEqual([2, 1])
  })

  it('toIndex 为负被夹到 0(对齐后端 Math.max)', () => {
    const icons = [icon(1, PAGE, 0), icon(2, PAGE, 1)]
    const next = moveIcon(icons, { id: 2, toPageId: PAGE, toIndex: -3 })
    expect(orderOf(next, PAGE)).toEqual([2, 1])
  })

  it('未知 id 原样返回副本', () => {
    const icons = [icon(1, PAGE, 0)]
    const next = moveIcon(icons, { id: 999, toPageId: PAGE, toIndex: 0 })
    expect(next).toEqual(icons)
    expect(next).not.toBe(icons) // 仍是新数组引用
  })

  it('单元素页移动到自身位序 → 不变', () => {
    const icons = [icon(1, PAGE, 0)]
    const next = moveIcon(icons, { id: 1, toPageId: PAGE, toIndex: 0 })
    expect(orderOf(next, PAGE)).toEqual([1])
  })

  it('不修改原数组(不可变)', () => {
    const icons = [icon(1, PAGE, 0), icon(2, PAGE, 1), icon(3, PAGE, 2)]
    const snapshot = icons.map((i) => ({ ...i }))
    moveIcon(icons, { id: 1, toPageId: PAGE, toIndex: 2 })
    expect(icons).toEqual(snapshot)
  })

  it('不影响其它页的图标', () => {
    const icons = [
      icon(1, PAGE, 0),
      icon(2, PAGE, 1),
      icon(3, /*page*/ 2, 0),
      icon(4, /*page*/ 2, 1),
    ]
    const next = moveIcon(icons, { id: 1, toPageId: PAGE, toIndex: 1 })
    // 页 2 完全不动(引用与字段均不变)
    const page2Before = icons.filter((i) => i.pageId === 2)
    const page2After = next.filter((i) => i.pageId === 2)
    expect(page2After).toEqual(page2Before)
    expect(orderOf(next, PAGE)).toEqual([2, 1])
  })
})

// 分组序列语义(ADR-0011 / issue 07):页面序列只含顶层行,组内成员不参与
// toIndex 定位与重排——对齐后端 IconService.move 的 topLevel 查询过滤。
describe('moveIcon — 组内成员不参与页面序列', () => {
  it('跨页移入含组的页:toIndex 按顶层位序解释,成员被忽略', () => {
    // 页1=[X];页2 顶层 [A(0), 组(1)],组成员 M(组内 0)、B 顶层(2)
    const PAGE2 = 2
    const base = [
      icon(1, PAGE2, 0),
      icon(9, PAGE2, 1, 'group'),
      icon(3, PAGE2, 2),
      icon(5, PAGE2, 0),
      icon(100, PAGE, 0),
    ].map((i) => (i.id === 5 ? { ...i, parentId: 9 } : i))
    // 把 X(100)移入页2 toIndex=1(顶层序列 [A,组,B] 的 1 号=组前)→ [A, X, 组, B]
    const next = moveIcon(base, { id: 100, toPageId: PAGE2, toIndex: 1 })
    expect(orderOf(next, PAGE2)).toEqual([1, 100, 9, 3])
    // 组内成员 M 的组内序不变
    const m = next.find((i) => i.id === 5)!
    expect(m.parentId).toBe(9)
    expect(m.sortOrder).toBe(0)
  })
})

// 跨页移动(issue 07):reducer 契约在 06 即预留(toPageId 任意),此处刻画跨页分支。
// 关键不变量:目标页按 0..n-1 重排;源页序号**不动**(留洞),由 onSettled invalidate
// 后服务端权威数据补齐——故乐观态短暂带洞是预期行为,不是 bug。
describe('moveIcon — 跨页移动', () => {
  const PAGE_A = 1
  const PAGE_B = 2

  it('移到非空目标页中段:被移项 pageId 变更,目标页重排,源页留洞', () => {
    // 页A=[A,B,C] 页B=[X,Y];把 B 移到页B 的 toIndex=1
    const icons = [
      icon(1, PAGE_A, 0),
      icon(2, PAGE_A, 1),
      icon(3, PAGE_A, 2),
      icon(10, PAGE_B, 0),
      icon(11, PAGE_B, 1),
    ]
    const next = moveIcon(icons, { id: 2, toPageId: PAGE_B, toIndex: 1 })

    // 被移项:B 现属页B,sortOrder=1
    const moved = next.find((i) => i.id === 2)!
    expect(moved.pageId).toBe(PAGE_B)
    expect(moved.sortOrder).toBe(1)

    // 目标页:按 sortOrder 升序 → [X, B, Y]
    expect(orderOf(next, PAGE_B)).toEqual([10, 2, 11])

    // 源页:A、C 原序号不动(留洞,sortOrder 0 与 2,中间缺 1)
    const a = next.find((i) => i.id === 1)!
    const c = next.find((i) => i.id === 3)!
    expect(a.sortOrder).toBe(0)
    expect(c.sortOrder).toBe(2)
    // 源页不再含被移项
    expect(next.filter((i) => i.pageId === PAGE_A).map((i) => i.id)).toEqual([1, 3])
  })

  it('移到空目标页:被移项独占页B 的 0 号位', () => {
    const icons = [icon(1, PAGE_A, 0), icon(2, PAGE_A, 1)]
    const next = moveIcon(icons, { id: 1, toPageId: PAGE_B, toIndex: 0 })
    expect(orderOf(next, PAGE_B)).toEqual([1])
    const moved = next.find((i) => i.id === 1)!
    expect(moved.pageId).toBe(PAGE_B)
    expect(moved.sortOrder).toBe(0)
  })

  it('toIndex 等于目标页长度 → 追加到末尾', () => {
    const icons = [icon(1, PAGE_A, 0), icon(10, PAGE_B, 0), icon(11, PAGE_B, 1)]
    const next = moveIcon(icons, { id: 1, toPageId: PAGE_B, toIndex: 2 })
    expect(orderOf(next, PAGE_B)).toEqual([10, 11, 1])
  })

  it('toIndex 超出上限被夹到末尾(对齐后端 Math.min)', () => {
    const icons = [icon(1, PAGE_A, 0), icon(10, PAGE_B, 0)]
    const next = moveIcon(icons, { id: 1, toPageId: PAGE_B, toIndex: 99 })
    expect(orderOf(next, PAGE_B)).toEqual([10, 1])
  })

  it('源页其它图标引用与字段完全不变(仅被移项离开)', () => {
    const icons = [
      icon(1, PAGE_A, 0),
      icon(2, PAGE_A, 1),
      icon(3, PAGE_A, 2),
      icon(10, PAGE_B, 0),
    ]
    const next = moveIcon(icons, { id: 2, toPageId: PAGE_B, toIndex: 0 })
    // 源页剩下的 A、C 与输入完全相等(字段不变)
    expect(next.find((i) => i.id === 1)).toEqual(icons[0])
    expect(next.find((i) => i.id === 3)).toEqual(icons[2])
    // 页B 原 X 仍为 0 号?不——B 插到 0 号把 X 挤到 1 号(目标页重排)
    expect(orderOf(next, PAGE_B)).toEqual([2, 10])
  })

  it('来回移动(跨页后再移回原页):走两步 reducer,最终落点正确', () => {
    const icons = [
      icon(1, PAGE_A, 0),
      icon(2, PAGE_A, 1),
      icon(3, PAGE_A, 2),
      icon(10, PAGE_B, 0),
    ]
    // 第一步:A 移到页B idx=1
    const step1 = moveIcon(icons, { id: 1, toPageId: PAGE_B, toIndex: 1 })
    expect(orderOf(step1, PAGE_B)).toEqual([10, 1])
    // 第二步:把 A 移回页A idx=1
    const step2 = moveIcon(step1, { id: 1, toPageId: PAGE_A, toIndex: 1 })
    // 页A(剔除 A 后剩 B=1,C=2)插 A 于 idx=1 → [B,A,C] → 重排 0,1,2
    expect(orderOf(step2, PAGE_A)).toEqual([2, 1, 3])
    const moved = step2.find((i) => i.id === 1)!
    expect(moved.pageId).toBe(PAGE_A)
    expect(moved.sortOrder).toBe(1)
    // 页B 恢复只剩 X
    expect(orderOf(step2, PAGE_B)).toEqual([10])
  })

  it('不修改原数组(不可变)', () => {
    const icons = [icon(1, PAGE_A, 0), icon(2, PAGE_A, 1), icon(10, PAGE_B, 0)]
    const snapshot = icons.map((i) => ({ ...i }))
    moveIcon(icons, { id: 1, toPageId: PAGE_B, toIndex: 0 })
    expect(icons).toEqual(snapshot)
  })
})
