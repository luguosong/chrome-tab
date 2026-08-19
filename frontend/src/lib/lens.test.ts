import { describe, expect, it } from 'vitest'
import { lensPixel, sdRoundRect } from './lens'

describe('sdRoundRect', () => {
  it('形状内为负、形状外为正', () => {
    // 100×50、r=10 → 内矩形半宽高 (40,15),轴向边界 = qx + r = 50
    expect(sdRoundRect(0, 0, 40, 15, 10)).toBeLessThan(0) // 中心
    expect(sdRoundRect(45, 0, 40, 15, 10)).toBeLessThan(0) // 直边内侧(未过 qx+r)
    expect(sdRoundRect(51, 0, 40, 15, 10)).toBeGreaterThan(0) // 直边外侧(过 qx+r)
    expect(sdRoundRect(49, 21, 40, 15, 10)).toBeGreaterThan(0) // 圆角区外(距圆角圆心 (40,15) 超过 r)
  })

  it('r=0 退化为直角矩形,角点距离为 0', () => {
    expect(sdRoundRect(50, 25, 50, 25, 0)).toBe(0)
  })
})

describe('lensPixel', () => {
  it('d=0(贴边缘)位移最强 255,|d|≥band 处不位移 128', () => {
    expect(lensPixel(0, 12)).toBe(255)
    expect(lensPixel(12, 12)).toBe(128)
    expect(lensPixel(100, 12)).toBe(128) // 形外远处
    expect(lensPixel(-100, 12)).toBe(128) // 形内深处
  })

  it('band 带内线性渐变', () => {
    expect(lensPixel(6, 12)).toBe(192) // 半带:128 + 127/2 = 191.5 → 192
  })
})
