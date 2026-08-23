import { describe, expect, it } from 'vitest'
import {
  FAV_BASE_PX,
  GRID_COLUMNS,
  GRID_ROWS,
  GROUP_PAD_PX,
  LABEL_GAP_PX,
  LABEL_LINE_HEIGHT,
  TILE_FONT_TIERS,
  faviconPx,
  iconCellGeometry,
  labelBlockPx,
  tileFont,
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

// 「上块下字」字号档(ADR-0016 注记 e):全类型统一主/次两档,长文本随块宽
// (cqw 容器查询单位)收缩不溢出。tileFont 是档位的唯一公式来源(TilePrimary/
// TileSecondary 消费),调字号只改 TILE_FONT_TIERS 一处。
describe('tileFont', () => {
  it('主/次两档:px 随 iconScale 同比缩放,cqw 档位钳制块宽占比', () => {
    expect(TILE_FONT_TIERS.primary).toEqual({ px: 14, cqw: 24 })
    expect(TILE_FONT_TIERS.secondary).toEqual({ px: 12, cqw: 20 })
  })

  it('默认档 scale=1 → min(基准px, 档位cqw)', () => {
    expect(tileFont(1, 'primary')).toBe('min(14px, 24cqw)')
    expect(tileFont(1, 'secondary')).toBe('min(12px, 20cqw)')
  })

  it('iconScale 同比缩放 px 档(cqw 档不变——块宽约束与缩放无关)', () => {
    expect(tileFont(1.5, 'primary')).toBe('min(21px, 24cqw)')
    expect(tileFont(2, 'secondary')).toBe('min(24px, 20cqw)')
  })
})

// 常数同源:名称行行高与画格 gap 此前是 iconLayout 硬编码镜像 Icon.tsx 的
// Tailwind 默认(leading 1.5 / gap-1),改样式侧会静默错位——现在同引一份导出。
describe('labelBlockPx 常数同源', () => {
  it('行高 1.5、gap 4,与 IconLabel/画格引用同一常量', () => {
    expect(LABEL_LINE_HEIGHT).toBe(1.5)
    expect(LABEL_GAP_PX).toBe(4)
    expect(labelBlockPx(true, 12)).toBe(Math.ceil(12 * LABEL_LINE_HEIGHT) + LABEL_GAP_PX)
  })

  it('名称隐藏 → 0(行开销不含 gap)', () => {
    expect(labelBlockPx(false, 12)).toBe(0)
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
