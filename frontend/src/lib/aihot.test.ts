import { describe, expect, it } from 'vitest'
import { formatDailyDate } from './aihot'

// formatDailyDate(CONTEXT.md「AI 日报」的日期标头):本地时区按日期-only 解析。
// 2026-08-25 实为星期二(上游日报页锚点),防时区/星期映射错位回归。

describe('formatDailyDate(纯格式化)', () => {
  it('日期 + 星期', () => {
    expect(formatDailyDate('2026-08-25')).toBe('2026年8月25日 · 星期二')
    expect(formatDailyDate('2026-01-01')).toBe('2026年1月1日 · 星期四')
  })

  it('非法输入原样返回,不抛', () => {
    expect(formatDailyDate('')).toBe('')
    expect(formatDailyDate('not-a-date')).toBe('not-a-date')
  })
})
