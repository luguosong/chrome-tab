import { describe, expect, it } from 'vitest'
import { DEFAULT_PAGE_CAPACITY, canFit, capacityFor, cellsUsed } from './iconCapacity'

// 对齐 spec §接缝2:容量纯函数输入输出断言,无 DOM。
// 后端单一事实源为 DEFAULT_CAPACITY_CELLS(64),前端此处镜像该约定。
// ADR-0016 单档化:每图标恒 1 格,cellsUsed = 顶层图标数。

describe('cellsUsed — 顶层图标计数(每图标 1 格)', () => {
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
})

describe('capacityFor — 列×行', () => {
  it('8×8 = 64(固定网格,与后端 DEFAULT_CAPACITY_CELLS 对齐)', () => {
    expect(capacityFor(8, 8)).toBe(64)
  })

  it('其它网格', () => {
    expect(capacityFor(6, 3)).toBe(18)
    expect(capacityFor(6, 5)).toBe(30)
    expect(capacityFor(4, 4)).toBe(16)
  })

  it('DEFAULT_PAGE_CAPACITY 为 8×8', () => {
    expect(DEFAULT_PAGE_CAPACITY).toBe(capacityFor(8, 8))
  })

  it('零维度 = 0', () => {
    expect(capacityFor(0, 4)).toBe(0)
    expect(capacityFor(6, 0)).toBe(0)
  })
})

describe('canFit — 能否再容纳一个新图标(恒 1 格)', () => {
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
})
