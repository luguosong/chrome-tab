import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
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

  it('peek 只认 TTL 未过期的新鲜缓存(引用与 get 命中路径一致),过期/无键 undefined;warnLabel 省缺不打日志', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-28T10:00:00Z'))
    const warns: string[] = []
    const origWarn = console.warn
    console.warn = (msg) => warns.push(String(msg))
    try {
      const src = cachedOrNull<string, number>({
        ttlMs: 60_000,
        fetch: async (key) => (key === 'bad' ? Promise.reject(new Error('HTTP 503')) : Promise.resolve(1)),
      })
      expect(src.peek('k')).toBeUndefined() // 从未取数
      const got = await src.get('k')
      expect(src.peek('k')).toBe(got) // 命中:同引用
      expect(await src.get('bad')).toBeNull() // 失败(无 lastGood)
      expect(warns).toEqual([]) // 省缺 warnLabel 不打日志
      vi.setSystemTime(new Date('2026-08-28T10:01:01Z')) // TTL 过期
      expect(src.peek('k')).toBeUndefined() // 过期即 undefined(不触发取数)
    } finally {
      console.warn = origWarn
    }
  })
})

/**
 * 裸 fetch 契约(ADR-0045):上游取数必经原语族——「超时防挂起 + 非 2xx 抛带 status」
 * 的不变量只在 common.ts 单点成立,前提是没人绕开原语直接触全局 fetch。wallpaper/
 * siteInfo 曾以 `deps.fetchFn ?? fetch` 注入形状漏网(注入间接层骗过 grep 清点,
 * 2026-08-31 补收),此断言把「grep 可断言」变成测试把关,防下一个域再漏。
 */
describe('裸 fetch 契约:上游取数必经原语族(ADR-0045)', () => {
  it('backend/src 非测试源码仅 common.ts(原语内部)与 ai/(LLM 族豁免)可触全局 fetch', () => {
    const srcDir = fileURLToPath(new URL('./', import.meta.url))
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = dir + name // dir 恒带尾斜杠(srcDir 与递归层皆是)
        if (statSync(p).isDirectory()) walk(p + '/')
        else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) {
          const rel = p.slice(srcDir.length)
          if (rel === 'common.ts' || rel.startsWith('ai/')) continue
          const lines = readFileSync(p, 'utf8').split('\n')
          lines.forEach((line, i) => {
            if (/\btypeof fetch\b|\?\?\s*fetch\b|(?<![.\w])fetch\s*\(/.test(line))
              offenders.push(`${rel}:${i + 1}: ${line.trim()}`)
          })
        }
      }
    }
    walk(srcDir)
    expect(offenders).toEqual([])
  })
})
