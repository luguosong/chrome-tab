import { useQuery } from '@tanstack/react-query'
import { parseFundamentals, type Fundamentals } from '../lib/companyOverview'

/**
 * 随价估值(总市值/市盈率),东财 push2,JSONP(同 useQuotes 套路,绕 CORS)。
 * 60s 轮询、与行情同节奏;secid 为 null 时禁用(指数/未识别前缀)。
 */
export function useFundamentals(secid: string | null) {
  return useQuery<Fundamentals | null>({
    queryKey: ['fundamentals', secid],
    enabled: !!secid,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    queryFn: async () => parseFundamentals(await loadPush2(secid!)),
  })
}

/** push2 的 cb= 是真正的 JSONP 函数调用(区别于腾讯的 var 赋值),需先挂回调再注入 script。 */
function loadPush2(secid: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const cb = `__em_cb_${Math.random().toString(36).slice(2)}`
    const w = window as unknown as Record<string, ((obj: unknown) => void) | undefined>
    const s = document.createElement('script')
    let done = false
    const timer = setTimeout(() => {
      if (!done) {
        cleanup()
        reject(new Error('估值超时'))
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
      reject(new Error('估值加载失败'))
    }
    s.src =
      'https://push2.eastmoney.com/api/qt/stock/get' +
      `?secid=${secid}` +
      '&fields=f57,f58,f116,f162' +
      `&cb=${cb}`
    document.body.appendChild(s)
  })
}
