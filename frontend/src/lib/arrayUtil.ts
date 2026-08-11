/**
 * 通用数组纯函数(对齐 frontend/src/lib/*.test.ts 的 DOM-free 测试先例)。
 * 当前唯一用途:PageTabs 拖拽重排时,把数组里的元素从一处移到另一处。
 * 抽成纯函数便于 Vitest 断言;组件层只做 UI 编排。
 */

/**
 * 返回新数组:把 arr[from] 移动到 to 位置,其余元素顺移。
 * 不修改原数组。越界或相同索引时原样返回(防御式,调用方通常已校验)。
 *
 * 例:moveItem(['a','b','c'], 0, 2) → ['b','c','a']
 */
export function moveItem<T>(arr: readonly T[], from: number, to: number): T[] {
  if (from < 0 || to < 0 || from >= arr.length || to >= arr.length) return [...arr]
  if (from === to) return [...arr]
  const next = [...arr]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}
