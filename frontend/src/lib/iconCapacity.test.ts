import { describe, expect, it } from 'vitest'
import {
  CELLS_PER_SIZE,
  DEFAULT_PAGE_CAPACITY,
  canFit,
  capacityFor,
  cellsUsed,
} from './iconCapacity'

// 对齐 spec §接缝2:容量纯函数输入输出断言,无 DOM。
// 后端单一事实源为 Size.cells()(small=1/medium=4/large=6)与 DEFAULT_CAPACITY_CELLS(24),
// 前端此处镜像该约定,故断言值与后端对齐。

describe('cellsUsed — 占用格子求和', () => {
  it('空页 = 0', () => {
    expect(cellsUsed([])).toBe(0)
  })

  it('单个各尺寸', () => {
    expect(cellsUsed([{ size: 'small' }])).toBe(1)
    expect(cellsUsed([{ size: 'medium' }])).toBe(4)
    expect(cellsUsed([{ size: 'large' }])).toBe(6)
  })

  it('混合尺寸累加', () => {
    const icons = [
      { size: 'small' as const },
      { size: 'small' as const },
      { size: 'medium' as const },
      { size: 'large' as const },
    ]
    expect(cellsUsed(icons)).toBe(1 + 1 + 4 + 6)
  })

  it('迁移默认页参考量级:P1=12 small(12 格)、P2=1 large(6 格)、P3=13 medium(52 格)', () => {
    const p1 = Array.from({ length: 12 }, () => ({ size: 'small' as const }))
    const p2 = [{ size: 'large' as const }]
    const p3 = Array.from({ length: 13 }, () => ({ size: 'medium' as const }))
    expect(cellsUsed(p1)).toBe(12)
    expect(cellsUsed(p2)).toBe(6)
    expect(cellsUsed(p3)).toBe(52) // 超过单页容量 → 迁移会拆页(spec §迁移)
  })

  it('与 CELLS_PER_SIZE 一致', () => {
    expect(cellsUsed([{ size: 'small' }, { size: 'medium' }, { size: 'large' }]))
      .toBe(CELLS_PER_SIZE.small + CELLS_PER_SIZE.medium + CELLS_PER_SIZE.large)
  })
})

describe('capacityFor — 列×行', () => {
  it('6×4 = 24(桌面典型,与后端 DEFAULT 对齐)', () => {
    expect(capacityFor(6, 4)).toBe(24)
  })

  it('其它网格', () => {
    expect(capacityFor(6, 3)).toBe(18)
    expect(capacityFor(6, 5)).toBe(30)
    expect(capacityFor(4, 4)).toBe(16)
  })

  it('DEFAULT_PAGE_CAPACITY 为 6×4', () => {
    expect(DEFAULT_PAGE_CAPACITY).toBe(capacityFor(6, 4))
  })

  it('零维度 = 0', () => {
    expect(capacityFor(0, 4)).toBe(0)
    expect(capacityFor(6, 0)).toBe(0)
  })
})

describe('canFit — 能否再容纳一个新图标', () => {
  it('空页能放任意尺寸', () => {
    expect(canFit([], 24, 'small')).toBe(true)
    expect(canFit([], 24, 'medium')).toBe(true)
    expect(canFit([], 24, 'large')).toBe(true)
  })

  it('恰好达到容量(small 填满 24 格):下一个 small 拒绝,无更大需求', () => {
    const full = Array.from({ length: 24 }, () => ({ size: 'small' as const }))
    expect(cellsUsed(full)).toBe(24)
    expect(canFit(full, 24, 'small')).toBe(false)
  })

  it('剩余 5 格:medium(需 4)能放,large(需 6)拒绝,small(需 1)能放', () => {
    // 19 small = 19 格,剩 5
    const icons = Array.from({ length: 19 }, () => ({ size: 'small' as const }))
    expect(canFit(icons, 24, 'small')).toBe(true)
    expect(canFit(icons, 24, 'medium')).toBe(true)
    expect(canFit(icons, 24, 'large')).toBe(false)
  })

  it('边界:剩正好等于所需 → 允许(对齐后端 needed > remaining 才拒)', () => {
    // 20 small = 20 格,剩 4 = medium 需求 → 允许
    const icons = Array.from({ length: 20 }, () => ({ size: 'small' as const }))
    expect(canFit(icons, 24, 'medium')).toBe(true)
    // 21 small = 21 格,剩 3 < medium 4 → 拒绝
    const icons2 = Array.from({ length: 21 }, () => ({ size: 'small' as const }))
    expect(canFit(icons2, 24, 'medium')).toBe(false)
  })

  it('改尺寸场景:剔除自身后再判(调用方职责)', () => {
    // 页内有 1 large(6 格)+ 满 small,要把 small 增到 large 需先移除该 small 再判
    const others = Array.from({ length: 18 }, () => ({ size: 'small' as const })) // 18 格
    expect(canFit(others, 24, 'large')).toBe(true) // 18 + 6 = 24 ≤ 24
  })
})
