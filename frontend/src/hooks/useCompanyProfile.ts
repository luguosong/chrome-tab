import { useQuery } from '@tanstack/react-query'
import { parseCompanyProfile, type CompanyProfile } from '../lib/companyOverview'

/**
 * 公司档案(行业/主营/官网/交易所/地区),东财 datacenter-web。
 * 该端点直发 Access-Control-Allow-Origin: *,浏览器 fetch 直连、无需代理(见 ADR-0004)。
 * 数据近永久 → staleTime 24h。secucode 为 null 时禁用(指数/未识别前缀)。
 */
export function useCompanyProfile(secucode: string | null) {
  return useQuery<CompanyProfile | null>({
    queryKey: ['company-profile', secucode],
    enabled: !!secucode,
    staleTime: 24 * 60 * 60 * 1000,
    // 静态数据:卸载(Modal 关闭)后也保留 24h,避免重开重取(见 ADR-0004)。
    gcTime: 24 * 60 * 60 * 1000,
    queryFn: async () => {
      const url =
        'https://datacenter-web.eastmoney.com/api/data/v1/get' +
        '?reportName=RPT_F10_BASIC_ORGINFO&columns=ALL' +
        `&filter=(SECUCODE="${secucode}")&pageNumber=1&pageSize=1`
      const res = await fetch(url)
      if (!res.ok) return null
      return parseCompanyProfile(await res.json())
    },
  })
}
