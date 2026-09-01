/** 腾讯 smartbox(smartbox.gtimg.cn/s3)搜索建议解析:全局 v_hint 的**值**(script 求值后
 *  引号已剥、\u 转义已解):市~码~名~拼音~类型^…;无结果为 "N"。symbol 归一到项目约定
 *  「两位市场前缀+代码」(见 CONTEXT.md「标的」):美股代码剥交易所后缀(.oq/.ps 等)再大写,
 *  如 aapl.oq → usAAPL。曾误按响应源文本形态解析(引号提取+JSON.parse),值形态无引号
 *  恒空候选——检索自上线起从未出过候选,2026-09-01 线上报障修正。 */
export type InstrumentCandidate = { symbol: string; name: string; market: string }

export function parseSmartbox(raw: string): InstrumentCandidate[] {
  if (!raw || raw === 'N') return []
  const out: InstrumentCandidate[] = []
  for (const item of raw.split('^')) {
    const [market, code, name] = item.split('~')
    if (!market || !code || !name) continue
    out.push({ symbol: market.toLowerCase() + code.split('.')[0].toUpperCase(), name, market })
  }
  return out
}

/** 检索词规范化:港股习惯写法 2513.HK → 上游可查的 02513(5 位零填充;上游不认 .HK
 *  后缀,实测 q=2513.HK 恒 N、q=02513 港股在前)。其余写法原样透传。 */
export function normalizeQuery(q: string): string {
  return q.replace(/^(\d{1,5})\.hk$/i, (_, digits: string) => digits.padStart(5, '0'))
}
