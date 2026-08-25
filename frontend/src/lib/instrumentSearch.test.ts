import { describe, expect, it } from 'vitest'
import { parseSmartbox } from './instrumentSearch'

// 真实 smartbox 响应串(smartbox.gtimg.cn/s3,2026-08-25 实测):
// 全局赋值体 v_hint="市场~代码~名称~拼音~类型^…"，名称为 \u 转义(UTF-8)，无结果为 "N"。
const SINGLE = 'v_hint="sh~600519~\\u8d35\\u5dde\\u8305\\u53f0~gzmt~GP-A"'
const MULTI =
  'v_hint="sh~601318~\\u4e2d\\u56fd\\u5e73\\u5b89~zgpa~GP-A^hk~02318~\\u4e2d\\u56fd\\u5e73\\u5b89~zgpa~GP^us~pngay.ps~PingAn~pingan~GP^sz~000001~\\u5e73\\u5b89\\u94f6\\u884c~payh~GP-A^sz~180201~\\u5e73\\u5b89\\u5e7f\\u5dde\\u5e7f\\u6cb3REIT~pagzghreit~FJ"'
const US_SUFFIX = 'v_hint="us~aapl.oq~\\u82f9\\u679c~pg~GP"'
const INDEX = 'v_hint="sh~000001~\\u4e0a\\u8bc1\\u6307\\u6570~szzs~ZS^sh~510210~\\u4e0a\\u8bc1\\u6307\\u6570ETF\\u5bcc\\u56fd~szzsetffg~ETF"'

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
    expect(parseSmartbox('v_hint="N"')).toEqual([])
    expect(parseSmartbox('')).toEqual([])
    expect(parseSmartbox('garbage')).toEqual([]) // 无引号字面量
  })
})
