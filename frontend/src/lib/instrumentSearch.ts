/** 腾讯 smartbox(smartbox.gtimg.cn/s3)搜索建议解析:全局赋值体 v_hint="市~码~名~拼音~类型^…"。
 *  名称 \u 转义(JSON 字面量);无结果为 "N"。symbol 归一到项目约定「两位市场前缀+代码」
 *  (见 CONTEXT.md「标的」):美股代码剥交易所后缀(.oq/.ps 等)再大写,如 aapl.oq → usAAPL。 */
export type InstrumentCandidate = { symbol: string; name: string; market: string }

export function parseSmartbox(raw: string): InstrumentCandidate[] {
  // 提取首个双引号字面量整体 JSON.parse,一次性解出全部 \u 转义;失败即无候选。
  const m = raw.match(/"([^"]*)"/)
  if (!m) return []
  let body: string
  try {
    body = JSON.parse(m[0]) as string
  } catch {
    return []
  }
  if (!body || body === 'N') return []
  const out: InstrumentCandidate[] = []
  for (const item of body.split('^')) {
    const [market, code, name] = item.split('~')
    if (!market || !code || !name) continue
    out.push({ symbol: market.toLowerCase() + code.split('.')[0].toUpperCase(), name, market })
  }
  return out
}
