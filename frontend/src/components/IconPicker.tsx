import { useMemo } from 'react'
import { faviconUrl } from '../lib/iconData'
import { normalizeUrl } from '../lib/normalizeUrl'
import { useSiteInfo } from '../api/siteInfo'

/**
 * nav 图标选择器(见 CONTEXT.md「图标覆盖」「站点信息」):派生 favicon + 站点信息
 * 抓到的图标候选 + 自定义图片地址。value='' 表示未覆盖(用派生);点候选/输自定义
 * 地址即写覆盖,再点派生候选即清除回落。与 LocationPicker 同为 editor 字段的专属
 * 控件(注册表驱动表单按 name 分发,AddDrawer 与 EditForm 共用)。
 */
export default function IconPicker({
  url,
  value,
  onChange,
  placeholder,
}: {
  /** 网址:站点信息抓取与派生 favicon 的基准。 */
  url: string
  /** 当前覆盖值;'' = 未覆盖(派生)。 */
  value: string
  onChange: (v: string) => void
  placeholder: string
}) {
  const { data, isFetching } = useSiteInfo(url)
  const derived = faviconUrl(normalizeUrl(url))
  const candidates = useMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const src of [derived, ...(data?.icons ?? [])]) {
      if (src && !seen.has(src)) {
        seen.add(src)
        out.push(src)
      }
    }
    return out
  }, [derived, data])

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {candidates.map((src) => {
          // 派生候选写入的值是 ''(清除覆盖);站点候选是其地址本身
          const pickValue = src === derived ? '' : src
          const selected = value === pickValue || (pickValue === '' && value === derived)
          return (
            <button
              key={src}
              type="button"
              onClick={() => onChange(pickValue)}
              title={src === derived ? '自动(按网址)' : src}
              className={`w-7 h-7 rounded-md bg-white/20 flex items-center justify-center transition ${
                selected ? 'ring-2 ring-accent' : 'hover:bg-white/30 opacity-80'
              }`}
            >
              <img
                src={src}
                alt=""
                referrerPolicy="no-referrer"
                className="w-5 h-5 object-contain"
              />
            </button>
          )
        })}
        {isFetching && <span className="text-[11px] text-white/50">获取中…</span>}
      </div>
      {/* 覆盖地址恒显当前值:命中候选也不清空输入框,避免用户手输的字「消失」 */}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label="图标图片地址"
        className="w-full px-2.5 py-1.5 rounded-md bg-white/20 text-white placeholder-white/50 text-xs outline-none focus:ring-2 focus:ring-accent"
      />
    </div>
  )
}
