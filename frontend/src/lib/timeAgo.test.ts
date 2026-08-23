import { describe, expect, it } from 'vitest'
import { timeAgo } from './timeAgo'

// timeAgo 是 aihot 榜单鲜度与 changelog 版本榜共用的时长口径(ADR-0022 移至中立位)(纯函数,注入 now 可直测)。
const NOW = Date.parse('2026-08-23T12:00:00Z')

describe('timeAgo', () => {
  it('分级:刚刚 / 分钟 / 小时 / 天', () => {
    const iso = (s: string) => new Date(s).toISOString()
    expect(timeAgo(iso('2026-08-23T11:59:31Z'), NOW)).toBe('刚刚')
    expect(timeAgo(iso('2026-08-23T11:30:00Z'), NOW)).toBe('30 分钟前')
    expect(timeAgo(iso('2026-08-23T09:00:00Z'), NOW)).toBe('3 小时前')
    expect(timeAgo(iso('2026-08-21T12:00:00Z'), NOW)).toBe('2 天前')
  })

  it('null / 非法 ISO 返回空串(调用方据此省略段)', () => {
    expect(timeAgo(null, NOW)).toBe('')
    expect(timeAgo('not-a-date', NOW)).toBe('')
  })
})
