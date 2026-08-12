import { describe, expect, it } from 'vitest'
import { decideReconciliation, tsValue, type MirrorRecord } from './reconcile'
import type { Config } from '../types'

function cfg(): Config {
  return { pages: [{ id: 1, name: 'P', sortOrder: 0 }], icons: [], layoutSettings: { gridWidth: 1024, gridGap: 8, iconScale: 1 }, updatedAt: '2026-08-12T10:00:00' }
}
function mirror(over: Partial<MirrorRecord> = {}): MirrorRecord {
  return { config: cfg(), updatedAt: '2026-08-12T10:00:00', dirty: false, ...over }
}

describe('tsValue', () => {
  it('null/undefined → -∞(最旧)', () => {
    expect(tsValue(null)).toBe(-Infinity)
    expect(tsValue(undefined)).toBe(-Infinity)
    expect(tsValue('')).toBe(-Infinity)
  })
  it('纳秒小数截到秒后仍可解析', () => {
    expect(tsValue('2026-08-12T10:30:00.123456789')).toBe(
      new Date('2026-08-12T10:30:00').getTime(),
    )
  })
  it('更晚的时间戳数值更大(可比)', () => {
    expect(tsValue('2026-08-12T10:30:00')).toBeGreaterThan(tsValue('2026-08-12T10:00:00'))
  })
})

describe('decideReconciliation', () => {
  it('本地无镜像 → pull(浏览器清空/首跑)', () => {
    expect(decideReconciliation(null, '2026-08-12T10:00:00')).toBe('pull')
  })
  it('本地非空 且 服务端无版本(丢失) → push(用本地恢复)', () => {
    expect(decideReconciliation(mirror(), null)).toBe('push')
  })
  it('本地空 且 服务端无版本 → none(都不用动)', () => {
    const empty = mirror({ config: { ...cfg(), pages: [] } })
    expect(decideReconciliation(empty, null)).toBe('none')
  })
  it('本地干净 + 服务端更新 → pull(另一设备改过)', () => {
    expect(decideReconciliation(mirror(), '2026-08-12T11:00:00')).toBe('pull')
  })
  it('本地干净 + 服务端未更新 → none', () => {
    expect(decideReconciliation(mirror(), '2026-08-12T10:00:00')).toBe('none')
  })
  it('本地脏 + 服务端未更新 → push(离线编辑重连)', () => {
    expect(decideReconciliation(mirror({ dirty: true }), '2026-08-12T10:00:00')).toBe('push')
  })
  it('本地脏 + 服务端更新 → conflict(另一端改过,服务端赢、本地留底)', () => {
    expect(decideReconciliation(mirror({ dirty: true }), '2026-08-12T11:00:00')).toBe('conflict')
  })
  it('本地脏 + 服务端无版本 → push(服务端丢失,推本地)', () => {
    expect(decideReconciliation(mirror({ dirty: true }), null)).toBe('push')
  })
})
