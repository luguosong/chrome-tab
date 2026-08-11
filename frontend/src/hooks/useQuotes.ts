import { useQuery } from '@tanstack/react-query'
import { parseQuote, type Quote } from '../lib/quoteParser'

export type QuoteMap = Record<string, Quote | null>

/**
 * <script> 加载腾讯 qt.gtimg.cn，读全局 v_<sym>，天然绕 CORS（免代理免 key）。
 * 60s 轮询；refetchIntervalInBackground=false 让页面隐藏时不刷（替代手写 document.hidden）。
 */
export function useQuotes(symbols: string[]) {
  return useQuery<QuoteMap>({
    queryKey: ['quotes', symbols],
    enabled: symbols.length > 0,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    queryFn: async () => {
      const raw = await loadQuotes(symbols)
      const out: QuoteMap = {}
      symbols.forEach((k) => (out[k] = parseQuote(raw[k])))
      return out
    },
  })
}

function loadQuotes(symbols: string[]): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    let done = false
    const timer = setTimeout(() => {
      if (!done) {
        cleanup()
        reject(new Error('行情超时'))
      }
    }, 8000)
    const cleanup = () => {
      clearTimeout(timer)
      s.remove()
    }
    s.onload = () => {
      done = true
      cleanup()
      const out: Record<string, string> = {}
      symbols.forEach((k) => (out[k] = (window as unknown as Record<string, string>)[`v_${k}`] || ''))
      resolve(out)
    }
    s.onerror = () => {
      cleanup()
      reject(new Error('行情加载失败'))
    }
    s.src = 'https://qt.gtimg.cn/q=' + symbols.join(',')
    document.body.appendChild(s)
  })
}
