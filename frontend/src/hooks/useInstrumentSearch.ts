import { useEffect, useRef, useState } from 'react'
import { parseSmartbox, type InstrumentCandidate } from '../lib/instrumentSearch'
import { loadVarScript } from '../lib/scriptLoader'

/**
 * 标的检索(见 CONTEXT.md「自选股」):腾讯 smartbox 建议接口,<script> 注入读全局
 * v_hint——与 useQuotes 同款通道,免代理免 key(ADR-0004 前端直连取向;注入生命周期
 * 单点 lib/scriptLoader,ADR-0046)。
 *
 * 竞态守卫:并发注入共享全局 v_hint,动态 script 无完成顺序保证——序号守卫丢弃所有
 * 非最新请求的结果,effect cleanup 经 abort 立即摘 script(就绪未执行的 script 被移除后
 * 多数浏览器不再执行)。已知残余窄窗:个别浏览器 remove 后仍执行就绪 script,若恰落在
 * 新请求 script 执行之后、其 onload 之前,最新请求读到被旧值覆盖的 v_hint——后果仅为
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
    const settle = (list: InstrumentCandidate[]) => {
      if (seq !== seqRef.current) return
      setCandidates(list)
      setLoading(false)
    }
    setLoading(true)
    const ac = new AbortController()
    loadVarScript(
      'https://smartbox.gtimg.cn/s3/?v=2&q=' + encodeURIComponent(query) + '&t=all',
      ['v_hint'],
      ac.signal,
    )
      .then((raw) => settle(parseSmartbox(raw['v_hint'])))
      .catch(() => settle([])) // 超时/加载失败/中止统一降级为空候选(本 hook 无 error 态)
    return () => {
      seqRef.current++ // 卸载/依赖变化 → 本请求的落定全部失效(原 settled 旗语义)
      ac.abort()
    }
  }, [q])

  return { candidates, loading }
}
