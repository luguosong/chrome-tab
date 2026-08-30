import { useEffect, useState } from 'react'

/**
 * 心跳时钟 hook:按 intervalMs 周期刷新「当前时刻」,驱动按分/按天重算的视图。
 * 三处消费前各持 useState+setInterval 手写(口径曾漂移:Modal 挂载即冻结、Clock
 * 10s、Icon 60s)——收拢单点,跨天/节流策略改一处。间隔按消费方精度取:
 * Clock 10s(分钟级显示)、倒计时 60s(天数按天变)。
 */
export default function useNow(intervalMs: number): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}
