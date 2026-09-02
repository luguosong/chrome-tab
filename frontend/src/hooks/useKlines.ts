import { useQuery } from '@tanstack/react-query'
import { latestDayOnly, parseKlines, type KlinePoint } from '../lib/kline'
import { loadJsonp } from '../lib/scriptLoader'

/**
 * K 线区档位(StockModal 胶囊):day=当日 1 分钟分时,1m/1y/all=日线近一月/近一年/全部。
 * 取数按档各拉各存(queryKey 含档位),互不共享缓存。
 */
export type KlineRange = 'day' | '1m' | '1y' | 'all'

/** 各档取数参数:日线三档差异只在 lmt(22 交易日≈近一月、250≈近一年);day 走 1 分钟线,一次拉足最长交易日(美股 390 根)再由 latestDayOnly 截当日。 */
const RANGE_PARAMS: Record<KlineRange, { klt: number; lmt: number }> = {
  day: { klt: 1, lmt: 480 },
  '1m': { klt: 101, lmt: 22 },
  '1y': { klt: 101, lmt: 250 },
  all: { klt: 101, lmt: 10_000 },
}

/**
 * 档位收盘序列(东财 push2his,JSONP 绕 CORS;注入生命周期单点 lib/scriptLoader,
 * ADR-0046)。staleTime 60s;仅当日档随行情 60s 轮询(收盘后轮询返回不变,与 quotes
 * 同节奏、Modal 关闭即停)。不重试:无效 secid(如美股指数 105.INX)会
 * ERR_EMPTY_RESPONSE,重试也不恢复,默认 3 次重试只会刷 3 条控制台报错。
 * secid 为 null 时禁用(未识别前缀)。公司与指数均适用。
 */
export function useKlines(secid: string | null, range: KlineRange) {
  const { klt, lmt } = RANGE_PARAMS[range]
  return useQuery<KlinePoint[]>({
    queryKey: ['klines', secid, range],
    enabled: !!secid,
    staleTime: 60_000,
    refetchInterval: range === 'day' ? 60_000 : undefined,
    refetchIntervalInBackground: false,
    retry: false,
    queryFn: async () => {
      const pts = parseKlines(
        await loadJsonp(
          (cb) =>
            'https://push2his.eastmoney.com/api/qt/stock/kline/get' +
            `?secid=${secid}` +
            '&fields1=f1,f2,f3,f4,f5,f6' +
            '&fields2=f51,f53' +
            `&klt=${klt}` +
            '&fqt=1' + // 前复权(仅日线语义;day 档带上无害)
            '&end=20500101' +
            `&lmt=${lmt}` +
            `&cb=${cb}`,
        ),
      )
      return range === 'day' ? latestDayOnly(pts) : pts
    },
  })
}
