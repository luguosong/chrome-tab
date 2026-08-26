import { describe, expect, it } from 'vitest'
import { dispatchEscape, registerEscHandler } from './escStack'

// Modal 嵌套时的 Esc 归属栈:谁后打开谁先收 Esc。
// 修多层各自 window keydown 同听 Esc 连环关的旧病(如 TodoModal 内开
// TodoDetail,按一次 Esc 两层同收)。ADR-0031。

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
