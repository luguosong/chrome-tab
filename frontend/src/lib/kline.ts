/**
 * K 线区(收盘价历史序列)纯函数接缝(见 CONTEXT.md「公司概述」K 线 / spec user story 11)。
 *
 * 数据来自东方财富 push2his(JSONP,同 useQuotes/useFundamentals 套路绕 CORS),fields2=f51,f53
 * → 每根 kline 为逗号串 "日期,收盘价"(如 "2026-08-10,1348.86")。公司与指数均适用。
 *
 * 三件事单点在此:时间档位声明(KLINE_RANGES)、响应解析(parseKlines)、图型决策
 * (klineChartModel:锚/y 域/横轴/悬浮涨跌基,按档位分派)——取数 hook 与图表组件只消费。
 */

export type KlinePoint = {
  date: string
  close: number
}

/** K 线区时间档位(见 CONTEXT.md「时间档位」)。 */
export type KlineRange = 'day' | '1m' | '1y' | 'all'

/**
 * 时间档位表——档位语义的唯一声明处(Record 穷尽,漏档编译红):label(胶囊)、取数参数
 * (东财 klt/lmt)、是否分时(横轴/涨跌锚/截根/轮询语义)、轮询节奏。加档 = 加一个条目。
 * 日线三档差异只在 lmt(22 交易日≈近一月、250≈近一年);day 走 1 分钟线,一次拉足最长
 * 交易日(美股 390 根)再由 latestDayOnly 截当日。
 */
export const KLINE_RANGES: Record<
  KlineRange,
  { label: string; klt: number; lmt: number; intraday: boolean; refetchInterval: number | undefined }
> = {
  day: { label: '当日', klt: 1, lmt: 480, intraday: true, refetchInterval: 60_000 },
  '1m': { label: '近一月', klt: 101, lmt: 22, intraday: false, refetchInterval: undefined },
  '1y': { label: '近一年', klt: 101, lmt: 250, intraday: false, refetchInterval: undefined },
  all: { label: '全部', klt: 101, lmt: 10_000, intraday: false, refetchInterval: undefined },
}

/** 安全取有限数;否则 null。 */
function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v !== '') {
    const n = parseFloat(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/**
 * 解析东财 push2his K 线响应(JSONP 回调拿到的对象)。
 * 形如 { data: { klines: ["2026-08-10,1348.86", ...] } }
 * 每行取第 0 列(日期)、第 1 列(收盘);列不足/收盘非有限数 → 跳过该行。
 * 列序契约:第 0/1 列 = 日期/收盘,依赖 hook 请求 fields2=f51,f53(东财按字段号升序返回);
 *   若改 fields2(如加 f52 开盘)须同步改本解析,否则第 1 列会静默变成其它字段。
 * data 缺失 / klines 空 / 非对象 → [](Modal 显示「暂无数据」)。
 */
export function parseKlines(raw: unknown): KlinePoint[] {
  if (!raw || typeof raw !== 'object') return []
  const data = (raw as { data?: unknown }).data
  if (!data || typeof data !== 'object') return []
  const klines = (data as { klines?: unknown }).klines
  if (!Array.isArray(klines)) return []
  const pts: KlinePoint[] = []
  for (const line of klines) {
    if (typeof line !== 'string') continue
    const a = line.split(',')
    const date = a[0]?.trim()
    const close = num(a[1])
    if (!date || close == null) continue
    pts.push({ date, close })
  }
  return pts
}

/**
 * 图型决策(渲染无关,组件只画):锚、y 域、横轴文案、悬浮涨跌基——全部按档位声明分派。
 * 调用方无脑传入 prevClose(行情域数据),是否消费由 KLINE_RANGES 裁决,两条档位语义住此
 * 不经调用方:日线不叠昨收(并入会改写 y 域与涨跌语义,e20c581 实锤);分时锚昨收、日线锚前一根。
 */
export type KlineChartModel = {
  /** 涨跌色基准:分时对昨收(缺省退化首根),日线恒首根。 */
  anchor: number
  /** y 域:分时并入锚(基准虚线防裁),日线只含收盘序列。 */
  domainMin: number
  domainMax: number
  /** 昨收基准虚线的取值:仅分时且昨收到位时有,否则 null(不画)。 */
  baseline: number | null
  /** 悬浮涨跌基:分时恒昨收(null 无 %),日线对前一根(首根无)。 */
  hoverBase: (i: number) => number | null
  /** 横轴文案:分时取 HH:MM,日线全串。 */
  time: (d: string) => string
}

export function klineChartModel(
  klines: KlinePoint[],
  range: KlineRange,
  prevClose: number | null,
): KlineChartModel {
  const intraday = KLINE_RANGES[range].intraday
  const closes = klines.map((k) => k.close)
  const anchor = (intraday ? prevClose : null) ?? closes[0] ?? 0
  const domain = intraday ? [...closes, anchor] : closes
  return {
    anchor,
    domainMin: domain.length ? Math.min(...domain) : 0, // 空序列防护(同 nearestIndex 不出 NaN 口径)
    domainMax: domain.length ? Math.max(...domain) : 0,
    baseline: intraday ? prevClose : null,
    // 涨跌基须 >0:0 不是合法基(上游畸形),作缺失处理免 Infinity%
    hoverBase: (i) => {
      const b = intraday ? prevClose : i > 0 ? closes[i - 1] : null
      return b != null && b > 0 ? b : null
    },
    time: (d) => (intraday ? d.slice(11) : d),
  }
}

/**
 * 分时档昨收:取响应级 data.preKPrice(与 klines 同一响应、同一前复权口径——跨厂商
 * 昨收在除权除息日会漂移一个分红/拆股量,故不从行情源取)。缺失/非有限数/0(0 不是
 * 合法昨收)→ null(消费端按「昨收未到」退化:无虚线、锚退首根)。
 */
export function parsePreClose(raw: unknown): number | null {
  if (!raw || typeof raw !== 'object') return null
  const data = (raw as { data?: unknown }).data
  if (!data || typeof data !== 'object') return null
  const v = num((data as { preKPrice?: unknown }).preKPrice)
  return v != null && v > 0 ? v : null
}

/**
 * 当日(1 分钟)档:只留最新一个交易日的根。东财按根数回溯(klt=1&lmt=N),
 * 周一早盘请求会混入上一交易日尾段,此处按末根的日期部分截掉——解析层单点,
 * 消费端不做防御。空数组 → []。
 */
export function latestDayOnly(pts: KlinePoint[]): KlinePoint[] {
  if (pts.length === 0) return []
  const day = pts[pts.length - 1].date.slice(0, 10)
  return pts.filter((p) => p.date.slice(0, 10) === day)
}

/**
 * 悬浮定位:指针横轴像素 → 最近一根的下标(x 均分铺满容器宽,同折线的 x 归一)。
 * 两端钳制在 [0, n-1];n≤1 恒 0(单点/空序列不出 NaN)。
 */
export function nearestIndex(px: number, width: number, n: number): number {
  if (n <= 1) return 0
  const i = Math.round((px / width) * (n - 1))
  return Math.min(n - 1, Math.max(0, i))
}
