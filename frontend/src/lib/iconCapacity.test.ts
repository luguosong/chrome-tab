import { describe, expect, it } from 'vitest'
import { DEFAULT_PAGE_CAPACITY, canFit, capacityFor, cellsUsed } from './iconCapacity'
import { iconCells } from './iconTypeRegistry'

// 对齐 spec §接缝2:容量纯函数输入输出断言,无 DOM。
// 后端单一事实源为 CAPACITY_CELLS(81),前端此处镜像该约定。
// ADR-0021:图标默认 1 格,类型可声明 size 跨格(AIHOT 3×2 = 6 格)。

describe('iconCells — 类型格数(ADR-0021/0022)', () => {
  it('未声明 size 的类型恒 1 格(nav/stock/group)', () => {
    for (const t of ['nav', 'stock', 'group'] as const) {
      expect(iconCells(t)).toBe(1)
    }
  })

  it('跨格类型 3×2 = 6 格(aihot / changelog,ADR-0022 changelog 为第二消费者)', () => {
    expect(iconCells('aihot')).toBe(6)
    expect(iconCells('changelog')).toBe(6)
    expect(iconCells('todo')).toBe(6)
  })
})

describe('cellsUsed — 顶层图标格数求和', () => {
  it('空页 = 0', () => {
    expect(cellsUsed([])).toBe(0)
  })

  it('单个图标 = 1 格', () => {
    expect(cellsUsed([{ parentId: null }])).toBe(1)
  })

  it('多个顶层图标累加', () => {
    const icons = Array.from({ length: 13 }, () => ({ parentId: null }))
    expect(cellsUsed(icons)).toBe(13)
  })

  // 分组容量语义(ADR-0011):组内成员(parentId 非空)不计。
  it('分组:组行计 1 格,组内成员不计容量', () => {
    const groupRow = { parentId: null }
    const members = Array.from({ length: 20 }, () => ({ parentId: 9 }))
    const top = { parentId: null }
    expect(cellsUsed([groupRow, ...members, top])).toBe(2)
  })

  it('跨格类型按 w×h 计:aihot 单独占 6 格', () => {
    expect(cellsUsed([{ parentId: null, type: 'aihot' as const }])).toBe(6)
  })

  it('混合:3 个 1 格(weather 收回 1×1)+ aihot 6 格 = 9 格', () => {
    const icons = [
      { parentId: null, type: 'nav' as const },
      { parentId: null, type: 'stock' as const },
      { parentId: null, type: 'weather' as const },
      { parentId: null, type: 'aihot' as const },
    ]
    expect(cellsUsed(icons)).toBe(9)
  })
})

describe('capacityFor — 列×行', () => {
  it('9×9 = 81(固定网格,与后端 CAPACITY_CELLS 对齐)', () => {
    expect(capacityFor(9, 9)).toBe(81)
  })

  it('其它网格', () => {
    expect(capacityFor(6, 3)).toBe(18)
    expect(capacityFor(6, 5)).toBe(30)
    expect(capacityFor(4, 4)).toBe(16)
  })

  it('DEFAULT_PAGE_CAPACITY 为 9×9', () => {
    expect(DEFAULT_PAGE_CAPACITY).toBe(capacityFor(9, 9))
  })

  it('零维度 = 0', () => {
    expect(capacityFor(0, 4)).toBe(0)
    expect(capacityFor(6, 0)).toBe(0)
  })
})

describe('canFit — 能否再容纳待放入图标', () => {
  it('空页能放', () => {
    expect(canFit([], 24)).toBe(true)
  })

  it('恰好达到容量:下一个拒绝', () => {
    const full = Array.from({ length: 24 }, () => ({ parentId: null }))
    expect(cellsUsed(full)).toBe(24)
    expect(canFit(full, 24)).toBe(false)
  })

  it('边界:剩正好 1 格 → 允许(对齐后端 needed > remaining 才拒)', () => {
    const icons = Array.from({ length: 23 }, () => ({ parentId: null }))
    expect(canFit(icons, 24)).toBe(true)
  })

  it('跨格放入:剩 5 格时 aihot(6 格)拒绝,剩 6 格允许', () => {
    const five = Array.from({ length: 19 }, () => ({ parentId: null })) // 24-5
    expect(canFit(five, 24, 6)).toBe(false)
    const six = Array.from({ length: 18 }, () => ({ parentId: null })) // 24-6
    expect(canFit(six, 24, 6)).toBe(true)
  })
})
