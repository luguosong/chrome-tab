import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BadRequest, cachedOrNull, jsonBody, optInt, optNullableInt, reqInt, reqName } from './common'

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
 * 请求体校验小件直测(ADR-0048):消息文案逐字对齐迁移前各处现状(icons/pages/
 * videoUpdates/config 的 400 用例不在契约测试里断言消息,此表驱动是消息形状的
 * 唯一守卫);null body(非 JSON 请求)收敛为字段缺失 → 400,不再 TypeError → 500。
 */
describe('请求体校验小件(ADR-0048)', () => {
  it('reqName:blank 抛 must not be blank、超长抛 size、返回 trim 值;前缀拼出定位路径', () => {
    expect(reqName({ name: '  工作区  ' })).toBe('工作区')
    expect(() => reqName({ name: '   ' })).toThrow(BadRequest)
    expect(() => reqName({ name: '' })).toThrow('name: must not be blank')
    expect(() => reqName({ name: 'a'.repeat(65) })).toThrow('name: size must be between 0 and 64')
    expect(() => reqName({}, 'name', 'pages[0]')).toThrow('pages[0].name: must not be blank')
    expect(() => reqName(null)).toThrow('name: must not be blank') // 非 JSON body → 400 非 500
  })

  it('reqInt:非整数抛 must not be null;min/max 越界抛范围文案', () => {
    expect(reqInt({ k: 3 }, 'k')).toBe(3)
    expect(() => reqInt({}, 'k')).toThrow('k: must not be null')
    expect(() => reqInt({ k: 'x' }, 'k')).toThrow('k: must not be null')
    expect(() => reqInt({ k: 1.5 }, 'k')).toThrow('k: must not be null')
    expect(reqInt({ k: 5 }, 'k', { range: { min: 1, max: 9 } })).toBe(5)
    expect(() => reqInt({ k: 10 }, 'k', { range: { min: 1, max: 9 } })).toThrow('k: 必须在 1~9 之间')
    expect(() => reqInt({ k: 0 }, 'k', { range: { min: 1, max: 9 } })).toThrow('k: 必须在 1~9 之间')
    expect(() => reqInt({}, 'id', { prefix: 'items[2]' })).toThrow('items[2].id: must not be null')
  })

  it('optInt:缺省/null 落 def(默认 0);非法整数抛必须是整数', () => {
    expect(optInt({}, 'k')).toBe(0)
    expect(optInt({ k: null }, 'k')).toBe(0)
    expect(optInt({}, 'k', { def: 4 })).toBe(4)
    expect(optInt({ k: 7 }, 'k')).toBe(7)
    expect(() => optInt({ k: 'x' }, 'k')).toThrow('k: 必须是整数')
    expect(() => optInt({ k: 99 }, 'k', { range: { min: 0, max: 9 } })).toThrow('k: 必须在 0~9 之间')
  })

  it('optNullableInt:缺省/null → null;非法抛必须是整数', () => {
    expect(optNullableInt({}, 'k')).toBeNull()
    expect(optNullableInt({ k: null }, 'k')).toBeNull()
    expect(optNullableInt({ k: 12 }, 'k')).toBe(12)
    expect(() => optNullableInt({ k: 1.5 }, 'k', 'icons[3]')).toThrow('icons[3].k: 必须是整数')
  })

  it('jsonBody:非 JSON/坏 body 收敛 null', async () => {
    const broken = { req: { json: () => Promise.reject(new SyntaxError('Unexpected token')) } }
    expect(await jsonBody(broken as never)).toBeNull()
    const ok = { req: { json: () => Promise.resolve({ a: 1 }) } }
    expect(await jsonBody(ok as never)).toEqual({ a: 1 })
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
    const offenders: string[] = []
    for (const { rel, lines } of srcFiles()) {
      if (rel === 'common.ts' || rel.startsWith('ai/')) continue
      lines.forEach((line, i) => {
        if (/\btypeof fetch\b|\?\?\s*fetch\b|(?<![.\w])fetch\s*\(/.test(line))
          offenders.push(`${rel}:${i + 1}: ${line.trim()}`)
      })
    }
    expect(offenders).toEqual([])
  })
})

/** 遍历 backend/src 非测试源码(grep 契约断言共用,ADR-0045/0048)。 */
function* srcFiles(): Generator<{ rel: string; lines: string[] }> {
  const srcDir = fileURLToPath(new URL('./', import.meta.url))
  const walk = function* (dir: string): Generator<{ rel: string; lines: string[] }> {
    for (const name of readdirSync(dir)) {
      const p = dir + name // dir 恒带尾斜杠(srcDir 与递归层皆是)
      if (statSync(p).isDirectory()) yield* walk(p + '/')
      else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) {
        yield { rel: p.slice(srcDir.length), lines: readFileSync(p, 'utf8').split('\n') }
      }
    }
  }
  yield* walk(srcDir)
}

/**
 * 请求体读取契约(ADR-0048):`c.req.json()` 与「坏 body 收敛」语义只在 common.ts 的
 * jsonBody 单点成立——迁移前 9 文件各持习语(8 处 `.catch(() => null)` + dida 一处
 * `.catch(() => ({}))`,收敛目标分叉正是 dida 微变的根因),后续小件的 null 容忍靠
 * 每处自觉;此断言防新域再手抄。text/parseBody/arrayBuffer 同禁——绕开 json 通道
 * 读 body 就是另立收敛点。
 */
describe('请求体读取契约:jsonBody 单点(ADR-0048)', () => {
  it('backend/src 非测试源码仅 common.ts(jsonBody 内部)可触 c.req 的 body 读取通道', () => {
    const offenders: string[] = []
    for (const { rel, lines } of srcFiles()) {
      if (rel === 'common.ts') continue
      lines.forEach((line, i) => {
        if (/c\.req\.(json|text|parseBody|arrayBuffer)\s*\(/.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`)
      })
    }
    expect(offenders).toEqual([])
  })
})
