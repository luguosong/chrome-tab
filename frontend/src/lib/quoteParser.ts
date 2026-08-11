/** 腾讯 qt.gtimg.cn ~ 分隔串：[3]最新价 [4]昨收，涨跌自算（[3]-[4]）。
 *  自算避免依赖后段涨跌字段——美股/指数字段数不一致。 */
export type Quote = { price: number; prev: number; change: number; pct: number }

export function parseQuote(raw: string | undefined | null): Quote | null {
  if (!raw) return null
  const a = raw.split('~')
  const price = parseFloat(a[3])
  const prev = parseFloat(a[4])
  if (!price || !prev) return null
  return { price, prev, change: price - prev, pct: (price - prev) / prev * 100 }
}
