import { afterEach, describe, expect, it, vi } from 'vitest'
import { cachedOrNull } from './common'

/**
 * cachedOrNull 原语的不变量直测(ADR-0042)——原 aihot/dida/trending 三域各自
 * 手写、五份测试间接重复断言的「TTL 命中 / 失败回落 lastGood / 从未成功 null」
 * 收拢为单点;域测试保留端到端面,不再各自重证这组不变量。
 */
describe('cachedOrNull:TTL + 宁旧勿空原语', () => {
  afterEach(() => vi.useRealTimers())

  it('三不变量:TTL 内回缓存不打上游;从未成功 null;TTL 过期+失败回落 lastGood(旧版 aihot 测试未覆盖的真路径)', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-28T10:00:00Z'))
    let fail = false
    let hits = 0
    const src = cachedOrNull({
      ttlMs: 60_000,
      fetch: async () => {
        hits++
        if (fail) throw new Error('HTTP 503')
        return { v: hits }
      },
      warnLabel: () => '测试源',
    })
    fail = true
    expect(await src.get('k')).toBeNull() // 从未成功 → null(上不上抛由域决定)
    expect(hits).toBe(1)
    fail = false
    expect(await src.get('k')).toEqual({ v: 2 }) // 成功入缓存
    expect(await src.get('k')).toEqual({ v: 2 }) // TTL 内命中:不打上游
    expect(hits).toBe(2)
    vi.setSystemTime(new Date('2026-08-28T10:01:01Z')) // TTL 过期 + 上游失败
    fail = true
    expect(await src.get('k')).toEqual({ v: 2 }) // 回落 lastGood,失败不静默清零
    expect(hits).toBe(3) // 失败不续 TTL:确实重试过
    expect((src.lastError('k') as Error).message).toBe('HTTP 503') // 原始因可查
    fail = false
    await src.get('k')
    expect(src.lastError('k')).toBeUndefined() // 成功即清
  })

  it('键互相隔离;invalidate 只清 TTL 缓存——下读重拉,失败仍有 lastGood 底', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-28T10:00:00Z'))
    let n = 0
    let failB = false
    const src = cachedOrNull<string, number>({
      ttlMs: 60_000,
      fetch: async (key) => {
        if (key === 'b' && failB) throw new Error('HTTP 503')
        return ++n
      },
      warnLabel: (key) => `测试源(${key})`,
    })
    expect(await src.get('a')).toBe(1)
    expect(await src.get('b')).toBe(2)
    expect(await src.get('a')).toBe(1) // a 命中缓存,b 不影响
    src.invalidate('a')
    expect(await src.get('a')).toBe(3) // 失效后重拉
    failB = true
    src.invalidate('b')
    vi.setSystemTime(new Date('2026-08-28T10:05:00Z'))
    expect(await src.get('b')).toBe(2) // invalidate 不动 lastGood:失败仍有底
  })

  it('onSuccess 域钩子随成功触发、异常自吞不牵连取数', async () => {
    const seen: string[] = []
    const src = cachedOrNull({
      ttlMs: 60_000,
      fetch: async (key: string) => key.toUpperCase(),
      warnLabel: (key) => `测试源(${key})`,
      onSuccess: (key) => {
        seen.push(key)
        if (key === 'boom') throw new Error('钩子炸了')
      },
    })
    expect(await src.get('x')).toBe('X')
    expect(await src.get('boom')).toBe('BOOM') // 钩子异常不影响返回值
    await new Promise((r) => setTimeout(r, 0)) // fire-and-forget 落定
    expect(seen).toEqual(['x', 'boom'])
  })
})
