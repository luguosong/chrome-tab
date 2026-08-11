import { describe, expect, it } from 'vitest'
import { parseQuote } from './quoteParser'

// 真实腾讯串片段（~ 分隔），仅 [3]最新价 [4]昨收 被 parseQuote 使用
const SAMPLE_US = '100~苹果~64713~308.26~313.06~308.00~316.00~305.00~…'
const SAMPLE_CN = '1~上证指数~000001~3085.98~3097.46~…'

describe('parseQuote', () => {
  it('美股串：解析 price/prev/change/pct', () => {
    const q = parseQuote(SAMPLE_US)!
    expect(q.price).toBe(308.26)
    expect(q.prev).toBe(313.06)
    expect(q.change).toBeCloseTo(-4.8, 2)
    expect(q.pct).toBeCloseTo(-1.53, 1)
  })

  it('A股串：解析并自算涨跌', () => {
    const q = parseQuote(SAMPLE_CN)!
    expect(q.price).toBe(3085.98)
    expect(q.change).toBeCloseTo(-11.48, 2)
  })

  it('空/缺字段返回 null', () => {
    expect(parseQuote('')).toBeNull()
    expect(parseQuote(null)).toBeNull()
    expect(parseQuote(undefined)).toBeNull()
    expect(parseQuote('no~tilde')).toBeNull() // [3][4] 缺失
    expect(parseQuote('a~b~c~x~y')).toBeNull() // [3][4] 非数字
  })
})
