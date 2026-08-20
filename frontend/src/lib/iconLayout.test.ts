import { describe, expect, it } from 'vitest'
import { faviconPx } from './iconLayout'

// ADR-0014 favicon 自相似拼版推导:fav = cols×32 + (cols−1)×gap,再乘 iconScale。
// 三档在任何 gap/scale 取值下保持推导关系。

describe('faviconPx', () => {
  it('默认 gap=8:小/中/大 = 32/72/112', () => {
    expect(faviconPx('small', 8)).toBe(32)
    expect(faviconPx('medium', 8)).toBe(72)
    expect(faviconPx('large', 8)).toBe(112)
  })

  it('gap 用户可调,推导随动(gap=0 紧拼 / gap=24 上限)', () => {
    expect(faviconPx('medium', 0)).toBe(64)
    expect(faviconPx('large', 0)).toBe(96)
    expect(faviconPx('large', 24)).toBe(3 * 32 + 2 * 24)
  })

  it('iconScale 同比缩放,推导关系不破', () => {
    expect(faviconPx('medium', 8, 1.5)).toBe(72 * 1.5)
    expect(faviconPx('small', 8, 0.75)).toBe(24)
  })
})
