/**
 * scriptLoader 行为面:经公开 seam(loadJsonp/loadVarScript)观测——Promise 落定、
 * script DOM 副作用(注入/摘除)、window 回调挂删。DOM 用最小 stub:被测是我们的
 * 注入生命周期逻辑,不是浏览器 script 语义(vitest 裸 node 环境,零新依赖,ADR-0046)。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadJsonp, loadVarScript } from './scriptLoader'

interface FakeScript {
  src: string
  onload: (() => void) | null
  onerror: (() => void) | null
  remove: () => void
}

let w: Record<string, unknown>
let scripts: FakeScript[]
/** appendChild 时刻的快照:src 已就位、window 上的键(回调通道验「先挂回调再注入」) */
let appended: { src: string; windowKeys: string[] }[]

beforeEach(() => {
  vi.useFakeTimers()
  w = {}
  scripts = []
  appended = []
  vi.stubGlobal(
    'document',
    {
      createElement: (_tag: string): FakeScript => {
        const s: FakeScript = { src: '', onload: null, onerror: null, remove: () => {} }
        s.remove = () => {
          const i = scripts.indexOf(s)
          if (i >= 0) scripts.splice(i, 1)
        }
        scripts.push(s)
        return s
      },
      body: { appendChild: (s: FakeScript) => appended.push({ src: s.src, windowKeys: Object.keys(w) }) },
    },
  )
  vi.stubGlobal('window', w)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('loadVarScript(var 通道)', () => {
  it('onload 后读全局变量落定,缺失兜底空串,并摘除 script', async () => {
    const p = loadVarScript('https://qt.gtimg.cn/q=sh600519', ['v_sh600519', 'v_missing'])
    expect(scripts).toHaveLength(1)
    expect(scripts[0].src).toBe('https://qt.gtimg.cn/q=sh600519')
    w['v_sh600519'] = 'v_sh600519=51.0~~'
    scripts[0].onload!()
    await expect(p).resolves.toEqual({ v_sh600519: 'v_sh600519=51.0~~', v_missing: '' })
    expect(scripts).toHaveLength(0)
  })

  it('8s 超时 reject「script 加载超时」并摘除 script', async () => {
    const p = loadVarScript('https://x', ['v_a'])
    const assertion = expect(p).rejects.toThrow('script 加载超时')
    await vi.advanceTimersByTimeAsync(7999)
    expect(scripts).toHaveLength(1) // 未到时不误杀
    await vi.advanceTimersByTimeAsync(1)
    await assertion
    expect(scripts).toHaveLength(0)
  })

  it('onerror reject「script 加载失败」', async () => {
    const p = loadVarScript('https://x', ['v_a'])
    const assertion = expect(p).rejects.toThrow('script 加载失败')
    scripts[0].onerror!()
    await assertion
    expect(scripts).toHaveLength(0)
  })

  it('落定后重复失败路径不再改变结果(settled 幂等)', async () => {
    const p = loadVarScript('https://x', ['v_a'])
    const s0 = scripts[0] // 落定后会被摘出 scripts,引用先抓住
    w['v_a'] = 'ok'
    s0.onload!()
    await expect(p).resolves.toEqual({ v_a: 'ok' })
    s0.onerror!() // 已落定:no-op,不产生二次落定
    await vi.advanceTimersByTimeAsync(8000)
    await expect(p).resolves.toEqual({ v_a: 'ok' })
    expect(scripts).toHaveLength(0)
  })
})

describe('loadJsonp(回调通道)', () => {
  it('先挂 window 回调再注入;上游回调落定后删回调、摘 script', async () => {
    const p = loadJsonp((cb) => `https://push2.eastmoney.com/x?cb=${cb}`)
    // 挂载先于注入:appendChild 时刻 window 上已有回调,且 src 已拼入 cb 名
    expect(appended).toHaveLength(1)
    expect(appended[0].src).toMatch(/[?&]cb=__jsonp_/)
    const cbName = appended[0].windowKeys.find((k) => k.startsWith('__jsonp_'))
    expect(cbName).toBeDefined()
    const fire = w[cbName!] as (obj: unknown) => void
    fire({ data: 42 })
    await expect(p).resolves.toEqual({ data: 42 })
    expect(w[cbName!]).toBeUndefined() // 用毕即删,不泄漏 window
    expect(scripts).toHaveLength(0)
  })

  it('超时路径同样删回调(settled 幂等覆盖两条成功外的路)', async () => {
    const p = loadJsonp((cb) => `https://x?cb=${cb}`)
    const cbName = Object.keys(w).find((k) => k.startsWith('__jsonp_'))!
    const assertion = expect(p).rejects.toThrow('script 加载超时')
    await vi.advanceTimersByTimeAsync(8000)
    await assertion
    expect(w[cbName]).toBeUndefined()
  })
})

describe('AbortSignal 取消(标的检索的早期摘除语义)', () => {
  it('abort 立即摘 script 并以 signal.reason reject', async () => {
    const ac = new AbortController()
    const reason = new Error('请求已过期')
    const p = loadVarScript('https://x', ['v_hint'], ac.signal)
    expect(scripts).toHaveLength(1)
    const assertion = expect(p).rejects.toBe(reason)
    ac.abort(reason)
    await assertion
    expect(scripts).toHaveLength(0)
  })

  it('abort 时回调通道同步删回调', async () => {
    const ac = new AbortController()
    const reason = new Error('请求已过期')
    const p = loadJsonp((cb) => `https://x?cb=${cb}`, ac.signal)
    const cbName = Object.keys(w).find((k) => k.startsWith('__jsonp_'))!
    const assertion = expect(p).rejects.toBe(reason)
    ac.abort(reason)
    await assertion
    expect(w[cbName]).toBeUndefined()
  })

  it('已中止的 signal:立即 reject、不注入任何 script', async () => {
    const ac = new AbortController()
    const reason = new Error('早已中止')
    ac.abort(reason)
    await expect(loadVarScript('https://x', ['v_a'], ac.signal)).rejects.toBe(reason)
    expect(scripts).toHaveLength(0)
  })
})

/**
 * script 注入契约(ADR-0046):注入生命周期全仓单点——「先挂后注入/8s 超时/清理/回调
 * 用毕删」的不变量只在 scriptLoader.ts 成立,前提是没人绕开 loader 自行注入 script。
 * 镜像 backend common.test 的裸 fetch 契约断言(ADR-0045 补记):把「grep 可断言」
 * 变成测试把关,防下一个域以任何注入形状漏网。
 */
describe('script 注入契约:注入生命周期必经 loader(ADR-0046)', () => {
  it('frontend/src 非测试源码仅 scriptLoader.ts 可 createElement("script")', () => {
    const srcDir = fileURLToPath(new URL('../', import.meta.url))
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = dir + name // dir 恒带尾斜杠(srcDir 与递归层皆是)
        if (statSync(p).isDirectory()) walk(p + '/')
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) {
          const rel = p.slice(srcDir.length)
          if (rel === 'lib/scriptLoader.ts') continue
          const lines = readFileSync(p, 'utf8').split('\n')
          lines.forEach((line, i) => {
            if (/createElement\(['"]script['"]\)/.test(line))
              offenders.push(`${rel}:${i + 1}: ${line.trim()}`)
          })
        }
      }
    }
    walk(srcDir)
    expect(offenders).toEqual([])
  })
})
