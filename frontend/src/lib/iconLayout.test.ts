import { describe, expect, it } from 'vitest'
import { FAV_BASE_PX, GRID_COLUMNS, GRID_ROWS, faviconPx } from './iconLayout'

// ADR-0016 单档化:fav = FAV_BASE_PX × iconScale,无档位、不随 gap。

describe('faviconPx', () => {
  it('默认 scale=1 → 基准 32', () => {
    expect(faviconPx()).toBe(32)
    expect(FAV_BASE_PX).toBe(32)
  })

  it('iconScale 同比缩放', () => {
    expect(faviconPx(1.5)).toBe(48)
    expect(faviconPx(0.75)).toBe(24)
    expect(faviconPx(2)).toBe(64)
  })
})

describe('固定网格', () => {
  it('8×8', () => {
    expect(GRID_COLUMNS).toBe(8)
    expect(GRID_ROWS).toBe(8)
  })
})
