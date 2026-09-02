import { describe, expect, it } from 'vitest'
import { isTranslateFresh } from './trending'

// 新鲜窗 = 5min;锚点 = max(fetchedAt, retryAt)(纯函数,注入 now 可直测)。
const NOW = Date.parse('2026-09-02T12:00:00Z')

describe('isTranslateFresh', () => {
  it('抓取时刻在窗内 → 新鲜(轮询闸与徽章闸同判)', () => {
    expect(isTranslateFresh('2026-09-02T11:58:00Z', 0, NOW)).toBe(true)
  })

  it('抓取时刻超窗 → 过窗(「暂未译出」聚合提示条接管)', () => {
    expect(isTranslateFresh('2026-09-02T11:00:00Z', 0, NOW)).toBe(false)
  })

  it('窗边界:恰好 5min 判过窗(< 严格)', () => {
    expect(isTranslateFresh('2026-09-02T11:55:00Z', 0, NOW)).toBe(false)
    expect(isTranslateFresh('2026-09-02T11:55:00.001Z', 0, NOW)).toBe(true)
  })

  it('retryAt 把锚点拉回当下:过窗数据 + 刚点重试 → 复活', () => {
    expect(isTranslateFresh('2026-09-02T11:00:00Z', NOW - 10_000, NOW)).toBe(true)
  })

  it('fetchedAt 缺失 / 空串(wire 防御)恒判窗外', () => {
    expect(isTranslateFresh(undefined, 0, NOW)).toBe(false)
    expect(isTranslateFresh('', 0, NOW)).toBe(false)
  })
})
