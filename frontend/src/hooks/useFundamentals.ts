import { useQuery } from '@tanstack/react-query'
import { parseFundamentals, type Fundamentals } from '../lib/companyOverview'
import { loadJsonp } from '../lib/scriptLoader'

/**
 * 随价估值(总市值/市盈率),东财 push2,JSONP(注入生命周期单点 lib/scriptLoader,
 * ADR-0046)。60s 轮询、与行情同节奏;secid 为 null 时禁用(指数/未识别前缀)。
 */
export function useFundamentals(secid: string | null) {
  return useQuery<Fundamentals | null>({
    queryKey: ['fundamentals', secid],
    enabled: !!secid,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    queryFn: async () =>
      parseFundamentals(
        await loadJsonp(
          (cb) =>
            'https://push2.eastmoney.com/api/qt/stock/get' +
            `?secid=${secid}` +
            '&fields=f57,f58,f116,f162' +
            `&cb=${cb}`,
        ),
      ),
  })
}
