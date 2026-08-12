import { describe, expect, it } from 'vitest'
import { pageTransitionFrame } from './pageTransition'

// 翻页位移分解(修复首末页回弹被夹)。纯函数断言,无 DOM。
// 核心不变量:scrollLeft 单调、恒在 [start,target] 内(防回归到"回弹烘进 scrollLeft")。

describe('pageTransitionFrame — 端点(t=0 / t=1)', () => {
  it('t=0:scrollLeft=start,overshoot=0', () => {
    const r = pageTransitionFrame(0, 1702, -1702)
    expect(r.scrollLeft).toBe(1702)
    expect(r.overshoot).toBeCloseTo(0, 10) // 用 toBeCloseTo 规避 -0 与 +0 的 toEqual 差异
  })

  it('t=1:scrollLeft=target(=start+distance),overshoot=0', () => {
    const r = pageTransitionFrame(1, 1702, -1702)
    expect(r.scrollLeft).toBeCloseTo(0, 6)
    expect(r.overshoot).toBeCloseTo(0, 6)
  })
})

describe('pageTransitionFrame — scrollLeft 恒不越界(回归守卫)', () => {
  // 这是本次修复的核心:scrollLeft 绝不能越过 target(否则首末页又会被浏览器夹掉回弹)。
  it('前进(distance>0):scrollLeft 全程 ∈ [start, target]', () => {
    const start = 0
    const target = 1702
    const distance = target - start
    for (let i = 0; i <= 100; i++) {
      const { scrollLeft } = pageTransitionFrame(i / 100, start, distance)
      expect(scrollLeft).toBeGreaterThanOrEqual(start)
      expect(scrollLeft).toBeLessThanOrEqual(target)
    }
  })

  it('后退(distance<0):scrollLeft 全程 ∈ [target, start]', () => {
    const start = 1702
    const target = 0
    const distance = target - start
    for (let i = 0; i <= 100; i++) {
      const { scrollLeft } = pageTransitionFrame(i / 100, start, distance)
      expect(scrollLeft).toBeGreaterThanOrEqual(target)
      expect(scrollLeft).toBeLessThanOrEqual(start)
    }
  })
})

describe('pageTransitionFrame — 回弹方向(transform 承担越界)', () => {
  it('前进(→末页方向):峰值 overshoot < 0(内容向左越界,等同原 easeOutBack 越过 target)', () => {
    let peak = 0
    for (let i = 0; i <= 100; i++) {
      peak = Math.min(peak, pageTransitionFrame(i / 100, 0, 1702).overshoot)
    }
    expect(peak).toBeLessThan(-1) // 明显向左越界(约 -163 量级)
  })

  it('后退(→首页方向):峰值 overshoot > 0(内容向右越界)', () => {
    let peak = 0
    for (let i = 0; i <= 100; i++) {
      peak = Math.max(peak, pageTransitionFrame(i / 100, 1702, -1702).overshoot)
    }
    expect(peak).toBeGreaterThan(1)
  })

  it('合成视觉越界 ≈ |distance| × ~9.5%(与原 easeOutBack 等价;transform 单独峰值更大是正常的)', () => {
    // 合成视觉位移 = -(scrollLeft-start) + overshoot,应 = -distance·back(t)。
    // back 峰值 ≈1.095,故越过 target 的量 ≈ 9.5%·|distance|。transform 分量单独看可达 ~25%,
    // 但被 scrollLeft(cubic)同步抵消,合成仍是 easeOutBack——这里只断言合成结果。
    const start = 0
    const distance = 1702
    let peakPast = 0
    for (let i = 0; i <= 400; i++) {
      const { scrollLeft, overshoot } = pageTransitionFrame(i / 400, start, distance)
      const visualDisp = -(scrollLeft - start) + overshoot
      peakPast = Math.max(peakPast, Math.abs(visualDisp) - Math.abs(distance))
    }
    const ratio = peakPast / Math.abs(distance)
    expect(ratio).toBeGreaterThan(0.07)
    expect(ratio).toBeLessThan(0.11)
  })
})
