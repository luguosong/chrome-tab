import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from './client'
import { normalizeUrl } from '../lib/normalizeUrl'

export interface SiteInfo {
  title: string
  icons: string[]
}

/** 探测地址:补协议后能解析出 http(s) 的完整 URL 才值得抓;否则 ''(不发请求)。 */
export function probeUrl(raw: string): string {
  const v = normalizeUrl(raw.trim())
  try {
    return /^https?:$/.test(new URL(v).protocol) ? v : ''
  } catch {
    return ''
  }
}

/** 输入停顿防抖(表单里网址是逐字符输入的,不防抖会逐键打后端)。 */
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/**
 * 站点信息(后端代理抓取,见 CONTEXT.md「站点信息」):新增/编辑「网站链接」表单的
 * 自动填充数据源。失败静默降级(retry 0)——名称手输、图标回落派生,不阻塞提交;
 * rawUrl 非法(空/非 http(s))时 enabled=false 不发请求。
 */
export function useSiteInfo(rawUrl: string) {
  const url = probeUrl(useDebounced(rawUrl, 600))
  return useQuery<SiteInfo>({
    queryKey: ['site-info', url],
    queryFn: () => apiFetch<SiteInfo>(`/api/site-info?url=${encodeURIComponent(url)}`),
    enabled: url !== '',
    staleTime: 10 * 60 * 1000,
    retry: 0,
  })
}

/**
 * nav 表单的站点信息自动填充(新增抽屉 TypeCard 与编辑 EditForm 共用,规格「新增/
 * 编辑表单共用逻辑」):按网址防抖抓取;title 仅在名称为空时填入——不覆盖用户输入
 * (名称是显式意图,同 CONTEXT.md「图标覆盖」的取舍)。非 nav 传 isNav=false 不发请求
 * (否则会把 stock 的 symbol 字段当网址探测)。
 */
export function useSiteInfoAutofill(
  isNav: boolean,
  url: string,
  setValues: Dispatch<SetStateAction<Record<string, unknown>>>,
) {
  const { data: siteInfo } = useSiteInfo(isNav ? url : '')
  useEffect(() => {
    if (!isNav || !siteInfo?.title) return
    setValues((prev) =>
      String(prev['name'] ?? '').trim() ? prev : { ...prev, name: siteInfo.title },
    )
  }, [siteInfo, isNav, setValues])
}
