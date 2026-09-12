/**
 * Esc 归属栈:多层 Modal 同开时(如待办 Modal 内弹待办详情),Esc 只关最上层。
 * 各 Modal 不再自挂 window keydown——旧写法两层同听,按一次 Esc 连环全关。
 * ModalShell 挂载时 register、卸载时调返回的注销函数;window 监听由本模块
 * 单点持有,空栈派发为 no-op。ADR-0031。
 */
type Entry = { id: number; onEscape: () => void }
const stack: Entry[] = []
let nextId = 1

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') dispatchEscape()
}

// 模块单例环境常驻监听即可;vitest node 环境无 window,跳过不炸(测试只测纯逻辑)。
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', onKeyDown)
}

/** 入栈并返回注销函数(卸载时调用,出栈)。 */
export function registerEscHandler(onEscape: () => void): () => void {
  const id = nextId++
  stack.push({ id, onEscape })
  return () => {
    const i = stack.findIndex((e) => e.id === id)
    if (i !== -1) stack.splice(i, 1)
  }
}

/** 把 Esc 派发给栈顶;空栈 no-op(如 Esc 被别处消费后的残余按键)。 */
export function dispatchEscape(): void {
  stack[stack.length - 1]?.onEscape()
}

/**
 * 「Esc 就地消化」keydown handler 工厂(行壳票 01,ADR-0040 漂移⑦的 idiom
 * 单点化):输入框/内嵌面板按 Esc 只取消本地状态(清草稿/退出重命名/关面板),
 * stopPropagation 挡住冒泡到本模块的 window 监听——否则 escStack 把整个 Modal
 * 关掉。非 Escape 键零副作用,可与 Enter 提交等分支并列挂同一 input。收编前
 * 五处手抄(VideoModal 管理 ×3、Icon 块内重命名、GroupOverlay 改名)。
 * 参数结构类型(非 React 类型):纯函数零 React 依赖,测试面即本文件。
 */
export function swallowEscape(consume: () => void) {
  return (e: { key: string; stopPropagation(): void }): void => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      consume()
    }
  }
}
