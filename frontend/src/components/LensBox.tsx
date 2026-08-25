import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { lensMapDataUrl } from '../lib/lens'

// 与 globals.css 里 .lens-panel 的 @supports 回落用同一表达式,两边判定保持一致
const LENS_SUPPORTED = typeof CSS !== 'undefined' && CSS.supports('backdrop-filter', 'url(#f)')

/**
 * L2 clear 折射容器(ADR-0012):mount 后按实测盒尺寸生成 rounded-rect SDF 位移贴图,
 * 注入元素专属 SVG 滤镜(feImage → feDisplacementMap×3 RGB 色散 → blur 0.7),
 * 内联 backdrop-filter 引用之;ResizeObserver 监听尺寸变化重建贴图。
 * 环境不支持 backdrop-filter: url() 时不生成滤镜,CSS @supports 回落 L1。
 *
 * 已知 Chromium 坑:自身或祖先 opacity < 1 会切断 backdrop 采样(backdrop root
 * 边界),折射瞬间失效——入场动画用 transform(scale/translate),勿用 opacity 渐显。
 * 性能约束:仅少量 chrome 元素使用,不大面积铺(每滤镜实例占 GPU 资源)。
 */
export function LensBox({
  radius,
  className = '',
  style,
  children,
}: {
  /** 盒子圆角(CSS 像素),贴图与滤镜半径须与之一致——rounded-full 时 = 元素实测高的一半
   *  (不能运行时实读:computed 值是字面 9999px 而非实际渲染半径),调用方按盒高推导
   *  手填,如 SearchBox(约 44px 高)传 22、右上圆钮(40px)传 20 */
  radius: number
  className?: string
  style?: CSSProperties
  children?: ReactNode
}) {
  // useId 含冒号,SVG url(#…) 引用里不安全,清成纯字母数字
  const fid = 'lens' + useId().replace(/[^a-zA-Z0-9]/g, '')
  const ref = useRef<HTMLDivElement>(null)
  const [lens, setLens] = useState<{ url: string; w: number; h: number } | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    // 贴图必须与元素同尺寸(map 不可跨尺寸缩放):mount 生成一次,resize 重建
    const rebuild = () => {
      const rect = el.getBoundingClientRect()
      const w = Math.round(rect.width)
      const h = Math.round(rect.height)
      if (w === 0 || h === 0) return
      setLens(prev => (prev && prev.w === w && prev.h === h ? prev : { url: lensMapDataUrl(w, h, radius), w, h }))
    }
    rebuild()
    const ro = new ResizeObserver(rebuild)
    ro.observe(el)
    return () => ro.disconnect()
  }, [radius])

  if (!LENS_SUPPORTED) {
    return (
      <div className={`lens-panel ${className}`} style={style}>
        {children}
      </div>
    )
  }
  return (
    <>
      <svg width="0" height="0" className="absolute" aria-hidden>
        {lens && (
          <filter
            id={fid}
            filterUnits="userSpaceOnUse"
            x="0"
            y="0"
            width={lens.w}
            height={lens.h}
            colorInterpolationFilters="sRGB"
          >
            <feImage href={lens.url} x="0" y="0" width={lens.w} height={lens.h} result="MAP" />
            {/* RGB 三通道 scale 微差 = 色散(rebane2001 gist 参数) */}
            <feDisplacementMap in="SourceGraphic" in2="MAP" scale="-148" xChannelSelector="R" yChannelSelector="R" result="D1" />
            <feDisplacementMap in="D1" in2="MAP" scale="-150" xChannelSelector="G" yChannelSelector="G" result="D2" />
            <feDisplacementMap in="D2" in2="MAP" scale="-152" xChannelSelector="B" yChannelSelector="B" result="D3" />
            {/* SVG 位移无超采样,0.7 模糊柔化边缘锯齿 */}
            <feGaussianBlur in="D3" stdDeviation="0.7" />
          </filter>
        )}
      </svg>
      <div
        ref={ref}
        className={`lens-panel ${lens ? '' : 'lens-fallback'} ${className}`}
        style={lens ? { ...style, backdropFilter: `url(#${fid}) blur(2px) saturate(160%)` } : style}
      >
        {children}
      </div>
    </>
  )
}
