import { useEffect, useRef, useState } from 'react'
import { parseSmartbox, type InstrumentCandidate } from '../lib/instrumentSearch'

/**
 * 标的检索(见 CONTEXT.md「自选股」):腾讯 smartbox 建议接口,<script> 注入读全局
 * v_hint——与 useQuotes 同款通道,免代理免 key(ADR-0004 前端直连取向)。
 *
 * 竞态守卫:并发注入共享全局 v_hint,动态 script 无完成顺序保证——序号守卫丢弃所有
 * 非最新请求的回调,effect cleanup 立即 s.remove()(就绪未执行的 script 被移除后多数
 * 浏览器不再执行)。已知残余窄窗:个别浏览器 remove 后仍执行就绪 script,若恰落在新
 * 请求 script 执行之后、其 onload 之前,最新请求读到被旧值覆盖的 v_hint——后果仅为
 * 连续快打时偶尔闪现上一次关键词的候选,下次输入自愈。防抖在调用方组件(同
 * LocationPicker/useWeatherLocations 的职责划分)。
 */
export function useInstrumentSearch(q: string) {
  const [candidates, setCandidates] = useState<InstrumentCandidate[]>([])
  const [loading, setLoading] = useState(false)
  const seqRef = useRef(0)

  useEffect(() => {
    const query = q.trim()
    if (!query) {
      seqRef.current++ // 使 in-flight 结果过期
      setCandidates([])
      setLoading(false)
      return
    }
    const seq = ++seqRef.current
    setLoading(true)
    const s = document.createElement('script')
    let settled = false
    const settle = (list: InstrumentCandidate[]) => {
      if (settled) return
      settled = true
      cleanup()
      if (seq !== seqRef.current) return
      setCandidates(list)
      setLoading(false)
    }
    const timer = setTimeout(() => settle([]), 8000)
    const cleanup = () => {
      clearTimeout(timer)
      s.remove()
    }
    s.onload = () =>
      settle(parseSmartbox((window as unknown as Record<string, string>)['v_hint'] ?? ''))
    s.onerror = () => settle([])
    s.src = 'https://smartbox.gtimg.cn/s3/?v=2&q=' + encodeURIComponent(query) + '&t=all'
    document.body.appendChild(s)
    return () => {
      settled = true // 依赖变化/卸载 → 本请求的回调全部失效
      cleanup()
    }
  }, [q])

  return { candidates, loading }
}
