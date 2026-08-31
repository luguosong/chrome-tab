import { useCallback, useEffect, useRef, useState } from 'react'

/** 退场时长:与 globals.css 退场族(.animate-pop-out 等)同名 0.2s 档,CSS 与
 * JS 各出现一次、不跨界共享。 */
export const EXIT_MS = 200

/**
 * 浮层退场协议(对称路径:从哪进就从哪出,2026-08-31):拦关闭 → 播退场 →
 * EXIT_MS 后真 onClose——父组件 state 不动,面板内容冻结播完再卸载。宿主:
 * ModalShell / ControlDrawer / GroupOverlay 三家单点;曾三处手抄且已发散
 * (ref 幂等 vs state 幂等,state 版在同 task 双关时会双起定时器、首个句柄被
 * 覆盖失联),收编于此。
 *
 * 幂等判据必须是 ref 而非 state:宿主的 Esc/关闭监听多为挂载期一次注册
 * (ModalShell 的 Esc 栈防重排、ControlDrawer 的 window keydown),闭包内
 * state 恒 stale,两个关闭事件落在同一 task 时都会通过 state 守卫。onClose
 * 经 ref 跟随(调用方多为内联箭头)。reduced-motion 下退场类不播
 * (globals.css 守卫),直接关免面板静止等待。
 */
export function useExitClose(onClose: () => void) {
  const [closing, setClosing] = useState(false)
  const closingRef = useRef(false)
  const timerRef = useRef<number | null>(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  /** 幂等;引用稳定(空依赖),供挂载期一次注册的监听安全持有。 */
  const requestClose = useCallback(() => {
    if (closingRef.current) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      onCloseRef.current()
      return
    }
    closingRef.current = true
    setClosing(true)
    timerRef.current = window.setTimeout(() => onCloseRef.current(), EXIT_MS)
  }, [])

  // 外部卸载(父组件不经 onClose 直接拆,如登出/路由切走)时清残留定时器
  useEffect(
    () => () => {
      if (timerRef.current != null) window.clearTimeout(timerRef.current)
    },
    [],
  )
  return { closing, requestClose }
}
