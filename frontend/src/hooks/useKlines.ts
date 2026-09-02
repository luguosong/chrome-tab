import { useQuery } from '@tanstack/react-query'
import {
  KLINE_RANGES,
  latestDayOnly,
  parseKlines,
  parsePreClose,
  type KlinePoint,
  type KlineRange,
} from '../lib/kline'
import { loadJsonp } from '../lib/scriptLoader'

/** 档位数据:收盘序列 + 分时档昨收(与序列同一响应、同一前复权口径;日线档恒 null)。 */
export type KlineData = {
  points: KlinePoint[]
  preClose: number | null
}

/**
 * 档位收盘序列(东财 push2his,JSONP 绕 CORS;注入生命周期单点 lib/scriptLoader,
 * ADR-0046)。档位语义(label/取数参数/是否分时/轮询节奏)单点 lib/kline.ts 的
 * KLINE_RANGES,本 hook 只消费;取数按档各拉各存(queryKey 含档位),互不共享缓存。
 * 分时档昨收取同响应 preKPrice(前复权口径,除权日不漂移),不取腾讯原始价。
 * staleTime 60s;仅当日档随行情 60s 轮询(收盘后轮询返回不变,与 quotes 同节奏、
 * Modal 关闭即停)。不重试:无效 secid(如美股指数 105.INX)会 ERR_EMPTY_RESPONSE,
 * 重试也不恢复,默认 3 次重试只会刷 3 条控制台报错。secid 为 null 时禁用(未识别
 * 前缀)。公司与指数均适用。
 */
export function useKlines(secid: string | null, range: KlineRange) {
  const def = KLINE_RANGES[range]
  return useQuery<KlineData>({
    queryKey: ['klines', secid, range],
    enabled: !!secid,
    staleTime: 60_000,
    refetchInterval: def.refetchInterval,
    refetchIntervalInBackground: false,
    retry: false,
    queryFn: async () => {
      const res = await loadJsonp(
        (cb) =>
          'https://push2his.eastmoney.com/api/qt/stock/kline/get' +
          `?secid=${secid}` +
          '&fields1=f1,f2,f3,f4,f5,f6' +
          '&fields2=f51,f53' +
          `&klt=${def.klt}` +
          '&fqt=1' + // 前复权——日线语义;day 档的 preKPrice 同口径(分时昨收同源的前提)
          '&end=20500101' +
          `&lmt=${def.lmt}` +
          `&cb=${cb}`,
      )
      return {
        points: def.intraday ? latestDayOnly(parseKlines(res)) : parseKlines(res),
        preClose: def.intraday ? parsePreClose(res) : null,
      }
    },
  })
}
