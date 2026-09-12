import { describe, expect, it } from 'vitest'
import { dispatchEscape, registerEscHandler, swallowEscape } from './escStack'

// Modal 嵌套时的 Esc 归属栈:谁后打开谁先收 Esc。
// 修多层各自 window keydown 同听 Esc 连环关的旧病(如 TodoModal 内开
// TodoDetail,按一次 Esc 两层同收)。ADR-0031。
// swallowEscape(行壳票 01):输入框/面板「Esc 就地消化」的收编——不冒泡到
// window 层的 escStack 把整个 Modal 关掉(ADR-0040 漂移⑦的 idiom 单点化)。

function makeHandler() {
  const calls: string[] = []
  return {
    calls,
    fn: () => calls.push('hit'),
  }
}

describe('escStack', () => {
  it('只派发栈顶:后注册者收到 Esc,先注册者不收', () => {
    const a = makeHandler()
    const b = makeHandler()
    const offA = registerEscHandler(a.fn)
    registerEscHandler(b.fn)

    dispatchEscape()

    expect(a.calls).toHaveLength(0)
    expect(b.calls).toHaveLength(1)
    offA()
  })

  it('卸载即出栈:顶层注销后 Esc 落到下一层', () => {
    const a = makeHandler()
    const b = makeHandler()
    registerEscHandler(a.fn)
    const offB = registerEscHandler(b.fn)

    offB()
    dispatchEscape()

    expect(a.calls).toHaveLength(1)
  })

  it('嵌套序:A 开 → B 开 → B 关 → A 收;空栈派发为 no-op 不炸', () => {
    const a = makeHandler()
    const offA = registerEscHandler(a.fn)
    const b = makeHandler()
    const offB = registerEscHandler(b.fn)

    offB() // B 关闭(如 TodoDetail 先收掉)
    dispatchEscape()
    expect(a.calls).toHaveLength(1)

    offA() // A 关闭后栈空
    expect(() => dispatchEscape()).not.toThrow()
  })
})

describe('swallowEscape', () => {
  /** 结构化假事件:React onKeyDown 的 KeyboardEvent 只用到 key 与 stopPropagation。 */
  function fakeKey(key: string) {
    const stopped: string[] = []
    return { key, stopPropagation: () => stopped.push('stopped'), stopped }
  }

  it('Escape:消费回调执行 + stopPropagation(就地消化,不冒泡关 Modal)', () => {
    const consumed: string[] = []
    const e = fakeKey('Escape')
    swallowEscape(() => consumed.push('cleared'))(e)
    expect(consumed).toEqual(['cleared'])
    expect(e.stopped).toEqual(['stopped'])
  })

  it('非 Escape 键(Enter/普通字符):零副作用,透传给其他分支', () => {
    const consumed: string[] = []
    for (const key of ['Enter', 'a', 'ArrowDown']) {
      const e = fakeKey(key)
      swallowEscape(() => consumed.push('cleared'))(e)
      expect(e.stopped).toHaveLength(0)
    }
    expect(consumed).toHaveLength(0)
  })

  it('返回的 handler 与 React onKeyDown 结构兼容(纯函数,无 window 依赖)', () => {
    const h = swallowEscape(() => {})
    expect(typeof h).toBe('function')
    expect(h).toHaveLength(1)
  })
})
