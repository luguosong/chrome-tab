import { useQuery } from '@tanstack/react-query'
import { parseKlines, type KlinePoint } from '../lib/kline'
import { loadJsonp } from '../lib/scriptLoader'

/** 取最近 N 个交易日收盘(日线、前复权)。120 约半年,够画趋势且 payload 小。 */
const LIMIT = 120

/**
 * 日线收盘序列(东财 push2his,JSONP 绕 CORS;注入生命周期单点 lib/scriptLoader,
 * ADR-0046)。staleTime 60s、不轮询:Modal 短生命周期,且 120 根 payload 比 push2 单点
 * 估值大;重开 Modal 超过 60s 才重取(区别于 quotes/fundamentals 的 60s 轮询节奏)。
 * secid 为 null 时禁用(未识别前缀)。公司与指数均适用。
 */
export function useKlines(secid: string | null) {
  return useQuery<KlinePoint[]>({
    queryKey: ['klines', secid],
    enabled: !!secid,
    staleTime: 60_000,
    // 不重试:无效 secid(如美股指数 105.INX)会 ERR_EMPTY_RESPONSE,重试也不恢复,
    // 默认 3 次重试只会刷 3 条控制台报错。Modal 短生命周期,重开即自然重取。
    retry: false,
    queryFn: async () =>
      parseKlines(
        await loadJsonp(
          (cb) =>
            'https://push2his.eastmoney.com/api/qt/stock/kline/get' +
            `?secid=${secid}` +
            '&fields1=f1,f2,f3,f4,f5,f6' +
            '&fields2=f51,f53' +
            '&klt=101' + // 日线
            '&fqt=1' + // 前复权
            '&end=20500101' +
            `&lmt=${LIMIT}` +
            `&cb=${cb}`,
        ),
      ),
  })
}
