import { describe, expect, it } from 'vitest'
import {
  FAV_BASE_PX,
  GRID_COLUMNS,
  GRID_ROWS,
  GROUP_PAD_PX,
  faviconPx,
  iconCellGeometry,
  labelBlockPx,
} from './iconLayout'

// ADR-0016 单档化:fav = FAV_BASE_PX × iconScale,无档位、不随 gap。

describe('faviconPx', () => {
  it('默认 scale=1 → 基准 56(1x 再放大,ADR-0016 注记 2026-08-23c)', () => {
    expect(faviconPx()).toBe(56)
    expect(FAV_BASE_PX).toBe(56)
  })

  it('iconScale 同比缩放', () => {
    expect(faviconPx(1.5)).toBe(84)
    expect(faviconPx(0.75)).toBe(42)
    expect(faviconPx(2)).toBe(112)
  })
})

describe('固定网格', () => {
  it('8×8', () => {
    expect(GRID_COLUMNS).toBe(8)
    expect(GRID_ROWS).toBe(8)
  })
})

// 单档几何(iconCellGeometry):行高由图标推导,iconScale 必须真实生效(修复
// 「>1×后不再变大」);轨道宽/画布高钳制防重叠防溢出。
describe('iconCellGeometry', () => {
  // labelBlockPx(true,12) = ceil(12×1.5)+4 = 22;行开销 = 22 + 2×3 = 28
  it('稀疏页矮画布:iconScale 全程生效到标称值(用户 bug 的回归)', () => {
    // 1366×768 实测:画布高 417、轨道宽 121,2 行图标
    for (const s of [0.75, 1, 1.25, 1.5, 1.75, 2]) {
      const { edge } = iconCellGeometry({
        iconScale: s, labelBlock: 22, gapY: 8, usedRows: 2, trackW: 121, gridH: 417,
      })
      expect(edge).toBe(56 * s)
    }
  })

  it('满 8 行矮画布:按行数压缩(画布硬冲突才让步,全体一致)', () => {
    const { edge, rowH } = iconCellGeometry({
      iconScale: 2, labelBlock: 22, gapY: 8, usedRows: 8, trackW: 121, gridH: 417,
    })
    expect(edge).toBe((417 - 8 * 28 - 7 * 8) / 8) // 17.125
    expect(rowH).toBe(edge + 28)
  })

  it('窄轨道:边长钳到轨道宽 − 分组余量(整体宽度最小也不重叠)', () => {
    // gridWidth=640 + 横向间距 24 → 轨道 59px
    const { edge } = iconCellGeometry({
      iconScale: 2, labelBlock: 22, gapY: 8, usedRows: 2, trackW: 59, gridH: 417,
    })
    expect(edge).toBe(59 - GROUP_PAD_PX * 2)
  })

  it('名称隐藏:行开销只剩分组余量', () => {
    expect(labelBlockPx(false, 12)).toBe(0)
    const { edge, rowH } = iconCellGeometry({
      iconScale: 1.5, labelBlock: 0, gapY: 8, usedRows: 2, trackW: 121, gridH: 417,
    })
    expect(edge).toBe(84)
    expect(rowH).toBe(84 + GROUP_PAD_PX * 2)
  })

  it('测量未回报(首帧):退化为标称值,不闪没', () => {
    const { edge } = iconCellGeometry({
      iconScale: 1.5, labelBlock: 22, gapY: 8, usedRows: 2, trackW: 0, gridH: 0,
    })
    expect(edge).toBe(84)
  })

  it('极端矮画布:heightFit 为负时钳 0,不留负尺寸', () => {
    const { edge, rowH } = iconCellGeometry({
      iconScale: 2, labelBlock: 22, gapY: 8, usedRows: 8, trackW: 121, gridH: 20,
    })
    expect(edge).toBe(0)
    expect(rowH).toBe(28)
  })
})
