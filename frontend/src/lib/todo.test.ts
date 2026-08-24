import { describe, expect, it } from 'vitest'
import { dueLabel, isOverdue } from './todo'

// CONTEXT.md「待办」:到期标签纯函数。时区口径与后端同源(UTC+8,与运行环境时区无关)。

describe('dueLabel', () => {
  const now = new Date('2026-08-24T03:00:00Z') // +08 = 08-24 11:00
  it('同一 +08 日 → HH:mm', () => {
    expect(dueLabel('2026-08-24T01:00:00+08:00', now)).toBe('01:00') // UTC 08-23 17:00,仍同 +08 日
    expect(dueLabel('2026-08-24T23:59:59+08:00', now)).toBe('23:59')
  })
  it('早于今日 → 过期N天', () => {
    expect(dueLabel('2026-08-20T10:00:00+08:00', now)).toBe('过期4天')
    expect(dueLabel('2026-08-23T23:00:00+08:00', now)).toBe('过期1天')
  })
  it('null / 非法串 → 空串', () => {
    expect(dueLabel(null, now)).toBe('')
    expect(dueLabel('not-a-date', now)).toBe('')
  })
})

describe('isOverdue', () => {
  const now = new Date('2026-08-24T03:00:00Z')
  it('早于今日 → true;今日(含未到时刻)与 null → false', () => {
    expect(isOverdue('2026-08-20T10:00:00+08:00', now)).toBe(true)
    expect(isOverdue('2026-08-24T23:00:00+08:00', now)).toBe(false)
    expect(isOverdue(null, now)).toBe(false)
  })
})
