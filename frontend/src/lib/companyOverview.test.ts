import { describe, expect, it } from 'vitest'
import {
  formatMarketCap,
  isIndexSymbol,
  parseCompanyProfile,
  parseFundamentals,
  symbolToSecid,
  symbolToSecucode,
} from './companyOverview'

// 公司概述取数纯函数(见 CONTEXT.md「公司概述」/ ADR-0004)。无 DOM。

describe('symbolToSecid — 符号→东财 secid(push2 用)', () => {
  it('沪深港美映射', () => {
    expect(symbolToSecid('sh600519')).toBe('1.600519')
    expect(symbolToSecid('sz000001')).toBe('0.000001')
    expect(symbolToSecid('hk00700')).toBe('116.00700')
    expect(symbolToSecid('usAAPL')).toBe('105.AAPL')
  })
  it('未识别前缀 → null(用于禁用 hook)', () => {
    expect(symbolToSecid('AAPL')).toBeNull()
    expect(symbolToSecid('')).toBeNull()
  })
})

describe('symbolToSecucode — 符号→东财 SECUCODE(datacenter filter 用)', () => {
  it('沪深港美映射', () => {
    expect(symbolToSecucode('sh600519')).toBe('600519.SH')
    expect(symbolToSecucode('sz000001')).toBe('000001.SZ')
    expect(symbolToSecucode('hk00700')).toBe('00700.HK')
    expect(symbolToSecucode('usAAPL')).toBe('AAPL.US')
  })
  it('未识别前缀 → null', () => {
    expect(symbolToSecucode('600519')).toBeNull()
  })
})

describe('isIndexSymbol — 指数识别(指数不渲染公司概述,见 ADR-0004 边界)', () => {
  it('A 股指数:上证 000xxx', () => {
    expect(isIndexSymbol('sh000001')).toBe(true) // 上证指数
    expect(isIndexSymbol('sh000300')).toBe(true) // 沪深300
    expect(isIndexSymbol('sh000016')).toBe(true) // 上证50
  })
  it('A 股指数:深证 399xxx', () => {
    expect(isIndexSymbol('sz399001')).toBe(true) // 深证成指
    expect(isIndexSymbol('sz399006')).toBe(true) // 创业板指
  })
  it('A 股个股不是指数(sh60x/sh68x/sz000/sz300 均为个股)', () => {
    expect(isIndexSymbol('sh600519')).toBe(false) // 贵州茅台
    expect(isIndexSymbol('sz000001')).toBe(false) // 平安银行(sz000 段是个股)
    expect(isIndexSymbol('sz300750')).toBe(false) // 宁德时代
  })
  it('美股指数(seed 内的道/纳/标普)', () => {
    expect(isIndexSymbol('usDJI')).toBe(true)
    expect(isIndexSymbol('usIXIC')).toBe(true)
    expect(isIndexSymbol('usINX')).toBe(true)
  })
  it('美股个股不是指数', () => {
    expect(isIndexSymbol('usAAPL')).toBe(false)
    expect(isIndexSymbol('usMSFT')).toBe(false)
  })
})

describe('parseCompanyProfile — 东财 datacenter 响应→公司档案', () => {
  it('正常返回抽取 MVP 三字段(industry 取 EM2016)', () => {
    const raw = {
      success: true,
      result: {
        data: [
          {
            ORG_PROFILE: '贵州茅台酒股份有限公司…',
            BUSINESS_SCOPE: '茅台酒及系列酒的生产与销售…',
            ORG_WEB: 'www.moutaichina.com',
            EM2016: '食品饮料-饮料-白酒',
            INDUSTRYCSRC1: '制造业-酒、饮料和精制茶制造业',
            TRADE_MARKET: '上海证券交易所',
            PROVINCE: '贵州',
          },
        ],
      },
    }
    const p = parseCompanyProfile(raw)
    expect(p).not.toBeNull()
    expect(p!.industry).toBe('食品饮料-饮料-白酒')
    expect(p!.businessScope).toBe('茅台酒及系列酒的生产与销售…')
    expect(p!.website).toBe('www.moutaichina.com')
  })
  it('EM2016 缺失时 industry 回退 INDUSTRYCSRC1', () => {
    const raw = {
      result: { data: [{ INDUSTRYCSRC1: '制造业-酒', TRADE_MARKET: '上交所' }] },
    }
    expect(parseCompanyProfile(raw)?.industry).toBe('制造业-酒')
  })
  it('data 为 null/空数组/失败 → null(指数或查无此公司)', () => {
    expect(parseCompanyProfile({ result: { data: null } })).toBeNull()
    expect(parseCompanyProfile({ result: { data: [] } })).toBeNull()
    expect(parseCompanyProfile({ success: false })).toBeNull()
    expect(parseCompanyProfile(null)).toBeNull()
  })
  it('data 行存在但字段全空 → null(实质无档案)', () => {
    expect(parseCompanyProfile({ result: { data: [{}] } })).toBeNull()
  })
})

describe('parseFundamentals — 东财 push2 响应→估值', () => {
  it('正常:f116 原值为市值,f162 ÷100 为市盈率', () => {
    const raw = {
      data: { f57: '600519', f58: '贵州茅台', f116: 1683234875746, f162: 1545 },
    }
    const f = parseFundamentals(raw)
    expect(f).not.toBeNull()
    expect(f!.marketCap).toBe(1683234875746)
    expect(f!.pe).toBe(15.45) // 1545 ÷ 100
  })
  it('f162 缺失/0/负 → pe=null(亏损或无数据)', () => {
    expect(parseFundamentals({ data: { f116: 1e10 } })?.pe).toBeNull()
    expect(parseFundamentals({ data: { f116: 1e10, f162: 0 } })?.pe).toBeNull()
  })
  it('f116 缺失 → 整体 null(无市值视为无效,指数降级)', () => {
    expect(parseFundamentals({ data: { f162: 1500 } })).toBeNull()
  })
  it('data 为 null/缺失 → null', () => {
    expect(parseFundamentals({ data: null })).toBeNull()
    expect(parseFundamentals({})).toBeNull()
  })
})

describe('formatMarketCap — 元→亿/万亿', () => {
  it('万亿档', () => {
    expect(formatMarketCap(1683234875746)).toBe('1.68万亿')
    expect(formatMarketCap(1e12)).toBe('1.00万亿')
  })
  it('亿档', () => {
    expect(formatMarketCap(218510638909)).toBe('2185.11亿')
    expect(formatMarketCap(1e8)).toBe('1.00亿')
  })
  it('0/null/负/过小 → null', () => {
    expect(formatMarketCap(0)).toBeNull()
    expect(formatMarketCap(null)).toBeNull()
    expect(formatMarketCap(-1)).toBeNull()
    expect(formatMarketCap(1e4)).toBeNull() // 不足亿,不展示
  })
})
