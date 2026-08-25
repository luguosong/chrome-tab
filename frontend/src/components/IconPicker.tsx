import { useMemo, useState, type ChangeEvent } from 'react'
import { faviconUrl } from '../lib/iconData'
import { prepareLocalIcon } from '../lib/localIcon'
import { normalizeUrl } from '../lib/normalizeUrl'
import { useSiteInfo } from '../api/siteInfo'

/**
 * nav 图标选择器(见 CONTEXT.md「图标覆盖」「站点信息」):派生 favicon + 站点信息
 * 抓到的图标候选 + 图片地址 + 本地图片。value='' 表示未覆盖(用派生);点候选/输地址/
 * 上传即写覆盖,再点派生候选或「恢复自动」即清除回落。与 LocationPicker 同为 editor
 * 字段的专属控件(注册表驱动表单按 name 分发,AddDrawer 与 EditForm 共用)。
 */
export default function IconPicker({
  url,
  value,
  onChange,
  onProcessingChange,
  placeholder,
}: {
  /** 网址:站点信息抓取与派生 favicon 的基准。 */
  url: string
  /** 当前覆盖值;'' = 未覆盖(派生)。 */
  value: string
  onChange: (v: string) => void
  onProcessingChange?: (processing: boolean) => void
  placeholder: string
}) {
  const { data, isFetching } = useSiteInfo(url)
  const [error, setError] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const derived = faviconUrl(normalizeUrl(url))
  const isEmbeddedWebp = value.startsWith('data:image/webp;base64,')
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

  function choose(v: string) {
    setError('')
    onChange(v)
  }

  async function pickFile(e: ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget
    const file = input.files?.[0]
    if (!file) return
    setError('')
    setIsProcessing(true)
    onProcessingChange?.(true)
    input.setCustomValidity('图片处理中…')
    try {
      choose(await prepareLocalIcon(file))
    } catch (err) {
      setError(err instanceof Error ? err.message : '图片处理失败')
    } finally {
      input.value = '' // 允许再次选择同一文件
      input.setCustomValidity('')
      onProcessingChange?.(false)
      setIsProcessing(false)
    }
  }

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
              disabled={isProcessing}
              onClick={() => choose(pickValue)}
              title={src === derived ? '自动(按网址)' : src}
              // w-8 热区 + rounded-lg(对齐图标层触控/圆角语汇);active:scale-95 与
              // Tile 按压缩放一致;焦点环走全局 focus-visible 范式
              className={`w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center transition active:scale-95 focus-visible:outline-2 focus-visible:outline-white/60 ${
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
        {isEmbeddedWebp && (
          <span
            title="本地上传"
            className="w-8 h-8 rounded-lg bg-white/20 ring-2 ring-accent flex items-center justify-center"
          >
            <img src={value} alt="" className="w-5 h-5 object-contain" />
          </span>
        )}
        {isFetching && <span className="text-xs text-white/50">获取中…</span>}
      </div>
      <div className="flex items-center gap-2 text-xs">
        <label
          aria-disabled={isProcessing}
          className={`px-2.5 py-1.5 rounded-md bg-white/20 text-white/85 transition focus-within:outline-2 focus-within:outline-white/60 ${
            isProcessing ? 'pointer-events-none opacity-50' : 'hover:bg-white/30 cursor-pointer'
          }`}
        >
          {isProcessing ? '处理中…' : isEmbeddedWebp ? '更换图片' : '选择本地图片'}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            onChange={pickFile}
          />
        </label>
        {value && (
          <button
            type="button"
            disabled={isProcessing}
            onClick={() => choose('')}
            className="px-2.5 py-1.5 rounded-md text-white/65 hover:text-white hover:bg-white/10 transition disabled:opacity-50"
          >
            恢复自动
          </button>
        )}
      </div>
      {/* 远程覆盖地址恒显当前值;本地 data URL 只显示上方预览,不塞进文本框。 */}
      <input
        value={isEmbeddedWebp ? '' : value}
        disabled={isProcessing}
        onChange={(e) => choose(e.target.value)}
        placeholder={placeholder}
        aria-label="图标图片地址"
        className="w-full px-2.5 py-1.5 rounded-md bg-white/20 text-white placeholder-white/50 text-xs outline-none focus:ring-2 focus:ring-accent disabled:opacity-50"
      />
      {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
    </div>
  )
}
