import { useEffect, useRef, useState } from 'react'
import { createHoverGrace } from '../lib/hoverGrace'

/**
 * 悬浮宽限接线(CONTEXT.md「悬浮宽限」):lib/hoverGrace 纯状态机的 React 侧。
 * 全局 mousemove 喂 pointerMove(指针追踪与门槛位移累计单点于此,宿主不再各自
 * 挂监听);floatingRef 挂浮层元素(判定时实时读盒);hovering 兼任显隐态与会话
 * 快照(泛型 payload,如快览卡的定位几何)。本 hook 不含可测逻辑(ADR-0040 §3),
 * 手势策略与计时全在 lib。返回的方法是状态机闭包上的稳定引用,可直接进 effect 依赖。
 * moveGatePx 仅首渲染读取(状态机懒建一次),宿主传模块常量即可。
 */
export function useHoverGrace<T = undefined>(moveGatePx?: number) {
  const [hovering, setHovering] = useState<T | null>(null)
  const floatingRef = useRef<HTMLDivElement>(null)
  const graceRef = useRef<ReturnType<typeof createHoverGrace<T>> | null>(null)
  if (graceRef.current === null) {
    graceRef.current = createHoverGrace<T>({
      onShow: (p) => setHovering(p),
      onHide: () => setHovering(null),
      getFloatingRect: () => floatingRef.current?.getBoundingClientRect() ?? null,
      moveGatePx,
    })
  }
  const grace = graceRef.current
  useEffect(() => {
    const onMove = (e: MouseEvent) => grace.pointerMove(e.clientX, e.clientY)
    window.addEventListener('mousemove', onMove)
    return () => {
      window.removeEventListener('mousemove', onMove)
      grace.dispose()
    }
  }, [grace])
  return { hovering, floatingRef, enter: grace.enter, leave: grace.leave, stay: grace.stay, close: grace.close }
}
