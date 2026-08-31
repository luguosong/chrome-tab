import { useQuery } from '@tanstack/react-query'
import { parseQuote, type Quote } from '../lib/quoteParser'
import { loadVarScript } from '../lib/scriptLoader'

export type QuoteMap = Record<string, Quote | null>

/**
 * <script> 加载腾讯 qt.gtimg.cn,读全局 v_<sym>,天然绕 CORS(免代理免 key;注入
 * 生命周期单点 lib/scriptLoader,ADR-0046)。60s 轮询;refetchIntervalInBackground=false
 * 让页面隐藏时不刷(替代手写 document.hidden)。
 */
export function useQuotes(symbols: string[]) {
  return useQuery<QuoteMap>({
    queryKey: ['quotes', symbols],
    enabled: symbols.length > 0,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    queryFn: async () => {
      const varOf = (k: string) => `v_${k}`
      const raw = await loadVarScript(
        'https://qt.gtimg.cn/q=' + symbols.join(','),
        symbols.map(varOf),
      )
      const out: QuoteMap = {}
      symbols.forEach((k) => (out[k] = parseQuote(raw[varOf(k)])))
      return out
    },
  })
}
