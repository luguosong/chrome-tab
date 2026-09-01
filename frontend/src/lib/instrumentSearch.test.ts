import { describe, expect, it } from 'vitest'
import { normalizeQuery, parseSmartbox } from './instrumentSearch'

// 真实 smartbox 全局变量 v_hint 的值(script 求值后:引号已剥、\u 转义已解,
// 2026-08-25 实测;2026-09-01 修正:此前 fixture 误用响应源文本形态,与
// loadVarScript 读到的变量值形态不符,测试假绿——检索自上线起从未出过候选):
// 市场~代码~名称~拼音~类型^…,无结果为 "N"。
const SINGLE = 'sh~600519~贵州茅台~gzmt~GP-A'
const MULTI =
  'sh~601318~中国平安~zgpa~GP-A^hk~02318~中国平安~zgpa~GP^us~pngay.ps~PingAn~pingan~GP^sz~000001~平安银行~payh~GP-A^sz~180201~平安广州广河REIT~pagzghreit~FJ'
const HK_NEW = 'hk~02513~智谱~zp~GP^hk~13093~智谱汇丰六乙购A~zphflyga~QZ'
const US_SUFFIX = 'us~aapl.oq~苹果~pg~GP'
const INDEX = 'sh~000001~上证指数~szzs~ZS^sh~510210~上证指数ETF富国~szzsetffg~ETF'

describe('parseSmartbox', () => {
  it('单候选 A 股:解析 symbol/名称/市场', () => {
    expect(parseSmartbox(SINGLE)).toEqual([{ symbol: 'sh600519', name: '贵州茅台', market: 'sh' }])
  })

  it('多候选:候选顺序保持,基金(REIT)顺带入列', () => {
    const cs = parseSmartbox(MULTI)!
    expect(cs).toHaveLength(5)
    expect(cs[0]).toEqual({ symbol: 'sh601318', name: '中国平安', market: 'sh' })
    expect(cs[4]).toEqual({ symbol: 'sz180201', name: '平安广州广河REIT', market: 'sz' })
  })

  it('港股候选入列(2026-09-01 线上报障:智谱检索无匹配)', () => {
    const cs = parseSmartbox(HK_NEW)!
    expect(cs[0]).toEqual({ symbol: 'hk02513', name: '智谱', market: 'hk' })
  })

  it('美股代码剥交易所后缀并大写:pngay.ps → usPNGAY、aapl.oq → usAAPL', () => {
    expect(parseSmartbox(US_SUFFIX)[0].symbol).toBe('usAAPL')
    expect(parseSmartbox(MULTI)![2].symbol).toBe('usPNGAY')
  })

  it('指数(ZS)与 ETF 候选照常入列', () => {
    const cs = parseSmartbox(INDEX)!
    expect(cs[0]).toEqual({ symbol: 'sh000001', name: '上证指数', market: 'sh' })
    expect(cs[1].symbol).toBe('sh510210')
  })

  it('无结果 "N" 与非法输入返回 []', () => {
    expect(parseSmartbox('N')).toEqual([])
    expect(parseSmartbox('')).toEqual([])
    expect(parseSmartbox('garbage')).toEqual([]) // 无 ~ 分段
  })
})

describe('normalizeQuery', () => {
  it('港股 .HK 后缀写法规范为 5 位零填充', () => {
    expect(normalizeQuery('2513.HK')).toBe('02513')
    expect(normalizeQuery('02513.hk')).toBe('02513') // 已 5 位不变
  })

  it('其余写法原样透传', () => {
    expect(normalizeQuery('智谱')).toBe('智谱')
    expect(normalizeQuery('usAAPL')).toBe('usAAPL')
    expect(normalizeQuery('600519')).toBe('600519')
  })
})
