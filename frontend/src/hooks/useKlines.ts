import { useQuery } from '@tanstack/react-query'
import { parseKlines, type KlinePoint } from '../lib/kline'

/** 取最近 N 个交易日收盘(日线、前复权)。120 约半年,够画趋势且 payload 小。 */
const LIMIT = 120

/**
 * 日线收盘序列(东财 push2his,JSONP 同 useFundamentals 套路绕 CORS)。
 * staleTime 60s、不轮询:Modal 短生命周期,且 120 根 payload 比 push2 单点估值大;
 * 重开 Modal 超过 60s 才重取(区别于 quotes/fundamentals 的 60s 轮询节奏)。
 * secid 为 null 时禁用(未识别前缀)。公司与指数均适用。
 */
export function useKlines(secid: string | null) {
  return useQuery<KlinePoint[]>({
    queryKey: ['klines', secid],
    enabled: !!secid,
    staleTime: 60_000,
    queryFn: async () => parseKlines(await loadPush2his(secid!, LIMIT)),
  })
}

/** push2his 同 push2 一样用 cb= 真正 JSONP 回调,需先挂回调再注入 script。 */
function loadPush2his(secid: string, lmt: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const cb = `__em_cb_${Math.random().toString(36).slice(2)}`
    const w = window as unknown as Record<string, ((obj: unknown) => void) | undefined>
    const s = document.createElement('script')
    let done = false
    const timer = setTimeout(() => {
      if (!done) {
        cleanup()
        reject(new Error('K线超时'))
      }
    }, 8000)
    const cleanup = () => {
      clearTimeout(timer)
      s.remove()
      delete w[cb]
    }
    w[cb] = (obj: unknown) => {
      done = true
      cleanup()
      resolve(obj)
    }
    s.onerror = () => {
      cleanup()
      reject(new Error('K线加载失败'))
    }
    s.src =
      'https://push2his.eastmoney.com/api/qt/stock/kline/get' +
      `?secid=${secid}` +
      '&fields1=f1,f2,f3,f4,f5,f6' +
      '&fields2=f51,f53' +
      '&klt=101' + // 日线
      '&fqt=1' + // 前复权
      '&end=20500101' +
      `&lmt=${lmt}` +
      `&cb=${cb}`
    document.body.appendChild(s)
  })
}
