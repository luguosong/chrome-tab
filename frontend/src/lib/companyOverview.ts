/**
 * 股票「公司概述」取数纯函数(见 CONTEXT.md「公司概述」/ ADR-0004)。
 *
 * 数据来自东方财富两个公开端点,均浏览器直连、无后端代理:
 *  - datacenter-web(静态公司档案):fetch,该端点直发 Access-Control-Allow-Origin: *
 *  - push2(随价估值 市值/PE):JSONP,与 useQuotes 同套路
 * 腾讯仅承担现有报价(F10 接口已废)。
 *
 * 抽为纯函数以便 Vitest 断言(同 iconCapacity / quoteParser 接缝)。
 */

export type CompanyProfile = {
  industry: string // EM2016 优先,回退 INDUSTRYCSRC1
  businessScope: string // BUSINESS_SCOPE(主营/经营范围)
  website: string // ORG_WEB
}

export type Fundamentals = {
  marketCap: number // 总市值(CNY,原值)
  pe: number | null // 市盈率 TTM(f162÷100);缺失/0/负 = null(亏损或无数据)
}

const PREFIX_SECID: Record<string, string> = {
  sh: '1',
  sz: '0',
  hk: '116',
  us: '105', // 默认按纳斯达克;us 前缀不区分交易所,NYSE 个股可能取不到 → 降级
}
const PREFIX_SECUCODE: Record<string, string> = {
  sh: 'SH',
  sz: 'SZ',
  hk: 'HK',
  us: 'US',
}

const US_INDEXES = new Set(['DJI', 'IXIC', 'INX', 'SPX', 'VIX'])

/** 符号(sh600519)→东财 secid(1.600519),push2 用。未识别前缀返回 null。 */
export function symbolToSecid(symbol: string): string | null {
  const m = /^([a-z]{2})(\w+)$/.exec(symbol)
  if (!m) return null
  const p = PREFIX_SECID[m[1]]
  return p ? `${p}.${m[2]}` : null
}

/** 符号(sh600519)→东财 SECUCODE(600519.SH),datacenter filter 用。未识别前缀返回 null。 */
export function symbolToSecucode(symbol: string): string | null {
  const m = /^([a-z]{2})(\w+)$/.exec(symbol)
  if (!m) return null
  const p = PREFIX_SECUCODE[m[1]]
  return p ? `${m[2]}.${p}` : null
}

/**
 * 指数识别(渲染期,不拆 IconType.STOCK 子类型,见 ADR-0004 边界):
 *  - 上证指数系列 sh000xxx(沪市 000 段为指数;个股在 60x/68x)
 *  - 深证指数系列 sz399xxx(sz000 段是个股如平安银行,非指数)
 *  - seed 内美股指数(DJI/IXIC/INX 等)
 * 指数无公司概述,Modal 只显示点位/涨跌。未命中的指数会自然降级(datacenter 查无 → profile=null),
 * 此处只对已知集合显式抑制,避免误显指数的聚合市值/市盈率。
 */
export function isIndexSymbol(symbol: string): boolean {
  if (/^sh000\d{3}$/.test(symbol)) return true
  if (/^sz399\d{3}$/.test(symbol)) return true
  const m = /^us(\w+)$/.exec(symbol)
  return !!m && US_INDEXES.has(m[1])
}

/** 安全取(去空白的)字符串。 */
function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
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
 * 解析东财 datacenter-web 公司档案响应。
 * 形如 { result: { data: [ { ORG_PROFILE, BUSINESS_SCOPE, ORG_WEB, EM2016, INDUSTRYCSRC1, TRADE_MARKET, PROVINCE } ] } }
 * data 为 null/空/响应失败/字段全空 → null(指数或查无此公司)。
 */
export function parseCompanyProfile(raw: unknown): CompanyProfile | null {
  if (!raw || typeof raw !== 'object') return null
  const result = (raw as { result?: { data?: unknown } }).result
  const data = result?.data
  if (!Array.isArray(data) || data.length === 0) return null
  const o = data[0]
  if (!o || typeof o !== 'object') return null
  const row = o as Record<string, unknown>
  const profile: CompanyProfile = {
    industry: str(row.EM2016) || str(row.INDUSTRYCSRC1),
    businessScope: str(row.BUSINESS_SCOPE),
    website: str(row.ORG_WEB),
  }
  // 至少一个字段有值才算有效(全空 = 实质无档案)
  if (!Object.values(profile).some((v) => v)) return null
  return profile
}

/**
 * 解析东财 push2 估值响应(JSONP 回调拿到的对象)。
 * 形如 { data: { f57, f58, f116(总市值), f162(PE×100) } }
 * 无市值(f116 缺失)→ null(指数可能无此字段,据此降级);pe:f162 缺失/0/负 → null。
 */
export function parseFundamentals(raw: unknown): Fundamentals | null {
  if (!raw || typeof raw !== 'object') return null
  const data = (raw as { data?: unknown }).data
  if (!data || typeof data !== 'object') return null
  const row = data as Record<string, unknown>
  const marketCap = num(row.f116)
  if (marketCap == null) return null
  const f162 = num(row.f162)
  const pe = f162 != null && f162 > 0 ? f162 / 100 : null
  return { marketCap, pe }
}

/** 总市值(元)格式化为"1.68万亿 / 2185.11亿"。无效/非正/不足亿 → null。 */
export function formatMarketCap(yuan: number | null | undefined): string | null {
  if (yuan == null || !Number.isFinite(yuan) || yuan <= 0) return null
  if (yuan >= 1e12) return (yuan / 1e12).toFixed(2) + '万亿'
  if (yuan >= 1e8) return (yuan / 1e8).toFixed(2) + '亿'
  return null
}
