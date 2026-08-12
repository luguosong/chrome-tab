/**
 * K 线(收盘价历史序列)取数纯函数(见 CONTEXT.md「公司概述」K 线 / spec user story 11)。
 *
 * 数据来自东方财富 push2his(JSONP,同 useQuotes/useFundamentals 套路绕 CORS),fields2=f51,f53
 * → 每根 kline 为逗号串 "日期,收盘价"(如 "2026-08-10,1348.86")。公司与指数均适用。
 *
 * 抽为纯函数以便 Vitest 断言(同 companyOverview / quoteParser 接缝)。
 */

export type KlinePoint = {
  date: string
  close: number
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
 * max 给定时只保留最近 max 根(klines 为旧→新)。
 * data 缺失 / klines 空 / 非对象 → [](Modal 显示「暂无数据」)。
 */
export function parseKlines(raw: unknown, max?: number): KlinePoint[] {
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
  return max != null && max > 0 ? pts.slice(-max) : pts
}
