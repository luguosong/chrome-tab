// ══════════════════════════════════════════════════════════════════════════
// PROTOTYPE ONLY(票 03 · Liquid Glass 视觉原型)— 一次性资产,勿在生产引用。
//
// 问题:Liquid Glass 落到真实壁纸 + 真实内容上长什么样、选哪一档?
// 三个材质策略变体经 ?variant=A|B|C 切换,浮动底栏可切壁纸与明暗:
//   A · 玻璃浮层 —— 去 L0 页板,图标各自玻璃 squircle 裸坐壁纸(Apple 范式)
//   B · 雾化画布 —— 保留 L0 页板,图标坐页板上(glass 叠 glass,现状强化)
//   C · 折射 chrome —— B 基础上搜索框/页签条/胶囊升 L2 SVG 折射(实测 backdrop-filter:url())
// 另含:叠放对照区(裸壁纸 vs 页板同屏并排)+ chrome 特写区。
//
// 计划一行:Three material-strategy variants on /prototype/liquid-glass,
// switchable via ?variant= + floating bar(壁纸/明暗), per prototype/UI.md。
// ══════════════════════════════════════════════════════════════════════════
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useWallpaper } from '../api/wallpaper'
import { lensMapDataUrl } from './prototype-lens'
import './prototype-liquid-glass.css'

// ── 变体与壁纸 ─────────────────────────────────────────────────────────────

const VARIANTS = [
  {
    key: 'A',
    name: 'A · 玻璃浮层',
    gist: '去 L0 页板:图标各自玻璃,裸坐壁纸(Apple 范式,功能层才上玻璃)',
  },
  {
    key: 'B',
    name: 'B · 雾化画布',
    gist: '保留 L0 页板:图标坐页板上(glass 叠 glass,现状结构强化)',
  },
  {
    key: 'C',
    name: 'C · 折射 chrome',
    gist: '同 B,搜索框/页签条/右上胶囊升 L2 SVG 折射 + 色散(实测 backdrop-filter:url())',
  },
] as const
type VariantKey = (typeof VARIANTS)[number]['key']

const STATIC_WALLPAPERS = [
  { id: 'bright', label: '亮 · 山湖', url: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=2400&q=80' },
  { id: 'dark', label: '暗 · 星雪', url: 'https://images.unsplash.com/photo-1519681393784-d120267933ba?w=2400&q=80' },
  { id: 'vivid', label: '艳 · 晨光', url: 'https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=2400&q=80' },
]

// ── mock 数据(原型只答视觉问题,数据全静态)──────────────────────────────

const favicon = (domain: string) =>
  `https://www.google.com/s2/favicons?domain=${domain}&sz=64`

const NAV_MOCKS = [
  { name: 'GitHub', domain: 'github.com' },
  { name: 'YouTube', domain: 'youtube.com' },
  { name: '哔哩哔哩', domain: 'bilibili.com' },
  { name: '知乎', domain: 'zhihu.com' },
  { name: '淘宝', domain: 'taobao.com' },
  { name: 'Gmail', domain: 'mail.google.com' },
]

const GROUP_MOCK = ['github.com', 'zhihu.com', 'youtube.com', 'bilibili.com', 'taobao.com', 'github.com', 'zhihu.com', 'youtube.com', 'bilibili.com']

const STOCK_MOCK = {
  name: '苹果',
  code: 'AAPL',
  price: 234.82,
  change: 2.89,
  pct: 1.24,
  cap: '3.55万亿',
  pe: 35.2,
  spark: [3, 8, 5, 10, 7, 12, 9, 14, 11, 16, 13, 18] as const,
}

const WEATHER_MOCK = {
  city: '杭州',
  temp: 28,
  text: '多云',
  humidity: 62,
  windDir: '东南风',
  windScale: 3,
  icon: '⛅',
}

const CHANGELOG_MOCK = [
  { v: '2.0.1', items: ['修复拖拽跨页时的位序抖动', '暗色壁纸下玻璃对比度增强'] },
  { v: '2.0.0', items: ['图标网格 8×8 全新容量模型', '走马灯环形切换(ADR-0008)'] },
]

// ── L2 折射容器:mount 后按实测盒尺寸生成专属滤镜(每实例一个 <filter>)──

function LensBox({
  radius,
  className = '',
  style,
  children,
}: {
  radius: number
  className?: string
  style?: CSSProperties
  children?: ReactNode
}) {
  // useId 含冒号,SVG url(#…) 引用不安全,清成纯字母数字
  const fid = 'l' + useId().replace(/[^a-zA-Z0-9]/g, '')
  const ref = useRef<HTMLDivElement>(null)
  const [lens, setLens] = useState<{ url: string; w: number; h: number } | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const w = Math.round(rect.width)
    const h = Math.round(rect.height)
    if (w === 0 || h === 0) return
    // 原型:尺寸固定,一次性生成;生产化需 ResizeObserver 重建
    setLens({ url: lensMapDataUrl(w, h, radius), w, h })
  }, [radius])
  return (
    <>
      <svg width="0" height="0" className="absolute" aria-hidden>
        {lens && (
          <filter
            id={`plx-lens-${fid}`}
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
        className={`plx-lens ${lens ? '' : 'plx-lens-fallback'} ${className}`}
        style={{
          ...style,
          ...(lens
            ? {
                backdropFilter: `url(#plx-lens-${fid}) blur(2px) saturate(160%)`,
                WebkitBackdropFilter: 'blur(2px) saturate(160%)',
              }
            : {}),
        }}
      >
        {children}
      </div>
    </>
  )
}

// ── 五种图标形态(决策 1/2/3:nav squircle / widget 式 / iOS 文件夹式)────

/** nav:app 图标式 —— 玻璃 squircle 包 favicon,名称在底板外下方(iOS 主屏式)。 */
function NavTile({
  nav,
  glass,
  favPx = 40,
  nameClass = 'text-[11px]',
}: {
  nav: (typeof NAV_MOCKS)[number]
  glass: 'full' | 'soft' // full=裸坐壁纸(变体 A);soft=坐 L0 页板(变体 B/C,视觉后退)
  favPx?: number
  nameClass?: string
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5">
      <div className={`flex items-center justify-center ${glass === 'full' ? 'plx-squircle' : 'plx-glass-soft rounded-[24%]'}`} style={{ width: favPx * 1.5, height: favPx * 1.5 }}>
        <img src={favicon(nav.domain)} alt="" width={favPx} height={favPx} className="rounded-[22%]" referrerPolicy="no-referrer" />
      </div>
      <span className={`${nameClass} text-white/90 max-w-full truncate text-center`}>{nav.name}</span>
    </div>
  )
}

/** 分组:iOS 文件夹式 —— 玻璃容器 + 3×3 迷你 favicon 预览 + 名称(决策 3)。 */
function GroupTile({ glass }: { glass: 'full' | 'soft' }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5">
      <div
        className={`grid grid-cols-3 gap-[3px] place-items-center ${glass === 'full' ? 'plx-folder' : 'plx-glass-soft rounded-[30%]'} p-1.5`}
        style={{ width: 60, height: 60 }}
      >
        {GROUP_MOCK.slice(0, 9).map((d, i) => (
          <img key={i} src={favicon(d)} alt="" width={14} height={14} className="rounded-[22%]" referrerPolicy="no-referrer" />
        ))}
      </div>
      <span className="text-[11px] text-white/90 max-w-full truncate">常用</span>
    </div>
  )
}

/** 自选股 widget:iOS 小组件式排版(决策 2:内容一并重排,不止换容器)。 */
function StockWidget({ size, glass }: { size: 'medium' | 'large'; glass: 'full' | 'soft' }) {
  const up = STOCK_MOCK.change >= 0
  const tone = up ? 'text-up' : 'text-down'
  const card = glass === 'full' ? 'plx-glass' : 'plx-glass-soft'
  const common = `${card} rounded-3xl p-3 text-left`
  if (size === 'medium') {
    return (
      <div className={`${common} flex flex-col justify-between`}>
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold text-white/85 tracking-wide">{STOCK_MOCK.code}</span>
          <span className={`text-[11px] ${tone}`}>{up ? '▲' : '▼'}</span>
        </div>
        <div className={`font-mono leading-none ${tone}`} style={{ fontSize: 26 }}>
          {STOCK_MOCK.price.toFixed(2)}
        </div>
        <div className="flex items-baseline justify-between">
          <span className={`font-mono text-[11px] ${tone}`}>
            {up ? '+' : ''}
            {STOCK_MOCK.pct.toFixed(2)}%
          </span>
          <span className="text-[10px] text-white/60 truncate">{STOCK_MOCK.name}</span>
        </div>
      </div>
    )
  }
  // large(3×2):左价格区 + 右 sparkline + 底部基本面行
  const max = Math.max(...STOCK_MOCK.spark)
  const min = Math.min(...STOCK_MOCK.spark)
  const pts = STOCK_MOCK.spark
    .map((v, i) => `${(i / (STOCK_MOCK.spark.length - 1)) * 100},${28 - ((v - min) / (max - min)) * 24}`)
    .join(' ')
  return (
    <div className={`${common} flex flex-col justify-between`}>
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-[13px] text-white/90">{STOCK_MOCK.name}</span>
            <span className="text-[10px] text-white/45 font-mono">{STOCK_MOCK.code}</span>
          </div>
          <div className="flex items-baseline gap-2 mt-0.5">
            <span className={`font-mono leading-none ${tone}`} style={{ fontSize: 24 }}>
              {STOCK_MOCK.price.toFixed(2)}
            </span>
            <span className={`font-mono text-[11px] ${tone}`}>
              {up ? '+' : ''}
              {STOCK_MOCK.change.toFixed(2)} ({STOCK_MOCK.pct.toFixed(2)}%)
            </span>
          </div>
        </div>
        {/* 迷你走势(SVG polyline,mock 数据) */}
        <svg viewBox="0 0 100 30" className="w-20 h-8" preserveAspectRatio="none" aria-hidden>
          <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.6" className={tone} />
        </svg>
      </div>
      <div className="text-[10px] text-white/55 font-mono">
        市值 {STOCK_MOCK.cap} · PE {STOCK_MOCK.pe.toFixed(1)}
      </div>
    </div>
  )
}

/** 天气 widget:iOS 天气小组组式排版。 */
function WeatherWidget({ size, glass }: { size: 'medium' | 'large'; glass: 'full' | 'soft' }) {
  const card = glass === 'full' ? 'plx-glass' : 'plx-glass-soft'
  const common = `${card} rounded-3xl p-3 text-left`
  if (size === 'medium') {
    return (
      <div className={`${common} flex flex-col justify-between`}>
        <span className="text-[11px] font-semibold text-white/85">{WEATHER_MOCK.city}</span>
        <div className="flex items-center gap-1.5">
          <span className="leading-none" style={{ fontSize: 22 }} aria-hidden>
            {WEATHER_MOCK.icon}
          </span>
          <span className="font-mono text-white/95 leading-none" style={{ fontSize: 26 }}>
            {WEATHER_MOCK.temp}°
          </span>
        </div>
        <span className="text-[10px] text-white/60">
          {WEATHER_MOCK.text} · 湿度 {WEATHER_MOCK.humidity}%
        </span>
      </div>
    )
  }
  return (
    <div className={`${common} flex items-center justify-between`}>
      <div>
        <div className="text-[13px] text-white/90">{WEATHER_MOCK.city}</div>
        <div className="flex items-baseline gap-2 mt-0.5">
          <span className="font-mono text-white/95 leading-none" style={{ fontSize: 28 }}>
            {WEATHER_MOCK.temp}°
          </span>
          <span className="text-[11px] text-white/70">{WEATHER_MOCK.text}</span>
        </div>
      </div>
      <div className="text-right space-y-0.5">
        <div className="leading-none" style={{ fontSize: 30 }} aria-hidden>
          {WEATHER_MOCK.icon}
        </div>
        <div className="text-[10px] text-white/60 font-mono">湿度 {WEATHER_MOCK.humidity}%</div>
        <div className="text-[10px] text-white/60 font-mono">
          {WEATHER_MOCK.windDir}
          {WEATHER_MOCK.windScale}级
        </div>
      </div>
    </div>
  )
}

/** 更新日志 widget:列表式小组件(changelog 类型仅 large)。 */
function ChangelogWidget({ glass }: { glass: 'full' | 'soft' }) {
  const card = glass === 'full' ? 'plx-glass' : 'plx-glass-soft'
  return (
    <div className={`${card} rounded-3xl p-3 text-left flex flex-col`}>
      <div className="text-[10px] uppercase tracking-wider text-white/60 mb-1.5">Claude Code 更新</div>
      <div className="flex-1 flex flex-col gap-1.5">
        {CHANGELOG_MOCK.map((e) => (
          <div key={e.v}>
            <span className="font-mono text-[12px] text-accent">{e.v}</span>
            <ul className="text-[11px] text-white/75 space-y-0.5 mt-0.5">
              {e.items.slice(0, 2).map((it, i) => (
                <li key={i} className="truncate">
                  · {it}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── 外围 chrome(决策 4:搜索框/页签条/时钟/抽屉 全部 Liquid Glass 化)────

/** 时钟:大字裸排(iOS 锁屏式),文字阴影代替玻璃底板。 */
function ChromeClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 10_000)
    return () => clearInterval(t)
  }, [])
  const time = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  const w = '日一二三四五六'[now.getDay()]
  return (
    <div className="plx-clock text-white select-none">
      <div className="text-5xl font-light tracking-tight leading-none tabular-nums">{time}</div>
      <small className="block text-xs font-light mt-1 opacity-85">
        {now.getMonth() + 1}月{now.getDate()}日 周{w}
      </small>
    </div>
  )
}

/** chrome 材质统一接缝:variant C → L2 折射盒;A/B → L1 玻璃。 */
function ChromeShell({
  variant,
  radius,
  className = '',
  style,
  children,
}: {
  variant: VariantKey
  radius: number
  className?: string
  style?: CSSProperties
  children?: ReactNode
}) {
  if (variant === 'C') {
    return (
      <LensBox radius={radius} className={className} style={style}>
        {children}
      </LensBox>
    )
  }
  return (
    <div className={`plx-glass ${className}`} style={style}>
      {children}
    </div>
  )
}

function ChromeSearch({ variant }: { variant: VariantKey }) {
  return (
    <ChromeShell variant={variant} radius={26} className="rounded-full flex items-center px-5 py-3 w-full max-w-[560px] mx-auto">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2" strokeLinecap="round" aria-hidden className="shrink-0">
        <circle cx="11" cy="11" r="7" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <span className="ml-3 text-sm text-white/60">搜索或输入网址,回车跳转</span>
    </ChromeShell>
  )
}

const TABS = ['工作', '看板', '资讯', '生活']

function ChromeTabs({ variant, active = 0 }: { variant: VariantKey; active?: number }) {
  return (
    <ChromeShell variant={variant} radius={21} className="rounded-full flex items-center gap-1 p-1">
      {TABS.map((t, i) => (
        <span
          key={t}
          className={
            'px-3 py-1 rounded-full text-[13px] whitespace-nowrap select-none ' +
            (i === active
              ? 'bg-white/75 text-zinc-900 font-medium shadow-sm'
              : 'text-white/80 hover:text-white')
          }
        >
          {t}
        </span>
      ))}
    </ChromeShell>
  )
}

function ChromeCorner({ variant }: { variant: VariantKey }) {
  return (
    <ChromeShell variant={variant} radius={22} className="rounded-full flex items-center gap-0.5 pl-1 pr-1 py-1">
      <span className="w-8 h-8 rounded-full text-white/90 hover:bg-white/25 flex items-center justify-center text-lg leading-none cursor-pointer">+</span>
      <span className="w-8 h-8 rounded-full text-white/90 hover:bg-white/25 flex items-center justify-center text-base leading-none cursor-pointer">⚙</span>
      <span className="mx-1 h-4 w-px bg-white/25" />
      <span className="text-[13px] text-white/85 px-1 select-none">luguosong</span>
      <span className="px-2.5 py-1 rounded-full text-[13px] text-white/85 hover:bg-white/25 cursor-pointer">登出</span>
    </ChromeShell>
  )
}

function ChromeArrow({ variant, dir }: { variant: VariantKey; dir: 'left' | 'right' }) {
  return (
    <ChromeShell variant={variant} radius={22} className="w-11 h-11 rounded-full flex items-center justify-center text-white/90 text-xl cursor-pointer">
      {dir === 'left' ? '‹' : '›'}
    </ChromeShell>
  )
}

// ── mockup 整体:一屏新标签页(8×8 网格 + 全套 chrome)────────────────────

function MockGrid({ variant }: { variant: VariantKey }) {
  // 图标底板策略:变体 A 裸坐壁纸 → full 玻璃;B/C 坐 L0 页板 → soft(轻一档)
  const glass: 'full' | 'soft' = variant === 'A' ? 'full' : 'soft'
  // 与生产一致的 grid span(SIZE_CELLS:small 1×1 / medium 2×2 / large 3×2)
  const cell = (c: number, r: number): CSSProperties => ({
    gridColumn: `span ${c}`,
    gridRow: `span ${r}`,
  })
  return (
    <div
      className="grid w-full"
      style={{
        gridTemplateColumns: 'repeat(8, minmax(0, 1fr))',
        gridTemplateRows: 'repeat(8, minmax(0, 1fr))',
        gridAutoFlow: 'dense',
        maxWidth: 880,
        gap: 10,
      }}
    >
      <div style={cell(1, 1)}><NavTile nav={NAV_MOCKS[0]} glass={glass} favPx={26} /></div>
      <div style={cell(1, 1)}><NavTile nav={NAV_MOCKS[1]} glass={glass} favPx={26} /></div>
      <div style={cell(1, 1)}><NavTile nav={NAV_MOCKS[2]} glass={glass} favPx={26} /></div>
      <div style={cell(1, 1)}><NavTile nav={NAV_MOCKS[3]} glass={glass} favPx={26} /></div>
      <div style={cell(1, 1)}><GroupTile glass={glass} /></div>
      <div style={cell(2, 2)} className="flex items-center justify-center">
        <NavTile nav={NAV_MOCKS[4]} glass={glass} favPx={36} nameClass="text-xs" />
      </div>
      <div style={cell(3, 2)}><StockWidget size="large" glass={glass} /></div>
      <div style={cell(3, 2)}><WeatherWidget size="large" glass={glass} /></div>
      <div style={cell(2, 2)}><StockWidget size="medium" glass={glass} /></div>
      <div style={cell(2, 2)}><WeatherWidget size="medium" glass={glass} /></div>
      <div style={cell(3, 2)}><ChangelogWidget glass={glass} /></div>
    </div>
  )
}

function Mockup({ variant, wallpaperUrl }: { variant: VariantKey; wallpaperUrl: string | undefined }) {
  return (
    <div className="relative h-[82vh] min-h-[600px] rounded-2xl overflow-hidden ring-1 ring-white/10">
      {/* 壁纸层(模拟生产 Background:cover + 1.05 + 可读性遮罩) */}
      <div className="absolute inset-0 bg-zinc-950">
        {wallpaperUrl ? (
          <div className="absolute inset-0 bg-center bg-cover" style={{ backgroundImage: `url(${wallpaperUrl})`, transform: 'scale(1.05)' }} />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-zinc-800 via-zinc-900 to-black" />
        )}
        <div className="absolute inset-0 bg-black/25 dark:bg-black/45" />
      </div>
      {/* 变体 B/C:整视口 L0 页板(现状结构);A 无此层 */}
      {variant !== 'A' && <div className="absolute inset-0 plx-page" />}
      {/* chrome + 内容 */}
      <div className="relative h-full flex flex-col px-6 py-5">
        <div className="flex items-start justify-between gap-4">
          <ChromeClock />
          <ChromeCorner variant={variant} />
        </div>
        <div className="mt-4">
          <ChromeSearch variant={variant} />
        </div>
        <div className="flex-1 min-h-0 flex items-center justify-center py-4">
          <MockGrid variant={variant} />
        </div>
        <div className="relative flex justify-center pb-1">
          <ChromeTabs variant={variant} />
          <div className="absolute left-0 top-1/2 -translate-y-1/2"><ChromeArrow variant={variant} dir="left" /></div>
          <div className="absolute right-0 top-1/2 -translate-y-1/2"><ChromeArrow variant={variant} dir="right" /></div>
        </div>
      </div>
    </div>
  )
}

// ── 叠放对照区:Apple 铁律「禁 glass 叠 glass」vs 本项目图标坐页板 ─────────

function CompareBoard({ wallpaperUrl, withPage }: { wallpaperUrl: string | undefined; withPage: boolean }) {
  return (
    <div className="relative w-[430px] h-[290px] rounded-xl overflow-hidden ring-1 ring-white/10">
      <div className="absolute inset-0 bg-zinc-950">
        {wallpaperUrl && (
          <div className="absolute inset-0 bg-center bg-cover" style={{ backgroundImage: `url(${wallpaperUrl})`, transform: 'scale(1.05)' }} />
        )}
        <div className="absolute inset-0 bg-black/25" />
      </div>
      {withPage && <div className="absolute inset-0 plx-page" />}
      <div className={`relative h-full flex items-center justify-center gap-3 p-4 ${withPage ? '' : ''}`}>
        <NavTile nav={NAV_MOCKS[0]} glass="full" favPx={22} nameClass="text-[10px]" />
        <NavTile nav={NAV_MOCKS[1]} glass="full" favPx={22} nameClass="text-[10px]" />
        <GroupTile glass="full" />
        <div className="w-[110px] h-[110px]"><StockWidget size="medium" glass="full" /></div>
        <NavTile nav={NAV_MOCKS[2]} glass="full" favPx={22} nameClass="text-[10px]" />
      </div>
      <span className="absolute bottom-2 left-3 text-[11px] text-white/80 plx-glass rounded-full px-2.5 py-0.5">
        {withPage ? '右 · 图标坐 L0 页板(现状 / B / C 方向)' : '左 · 图标裸坐壁纸(A 方向)'}
      </span>
    </div>
  )
}

// ── chrome 特写区:逐组件放当前变体材质,供细看圆角/高光/文本对比度 ────────

function DrawerMock() {
  return (
    <div className="w-[260px] rounded-2xl overflow-hidden">
      <div className="plx-glass rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium text-white/90">布局设置</span>
          <span className="w-6 h-6 rounded-full bg-white/20 text-white/80 text-xs flex items-center justify-center cursor-pointer">×</span>
        </div>
        {[
          { label: '整体宽度', value: 1080 },
          { label: '图标间距', value: 12 },
          { label: '图标缩放', value: 1.0 },
        ].map((row) => (
          <div key={row.label} className="mb-3">
            <div className="flex justify-between text-[11px] text-white/70 mb-1">
              <span>{row.label}</span>
              <span className="font-mono">{row.value}</span>
            </div>
            <div className="h-1.5 rounded-full bg-white/20 relative">
              <span className="absolute inset-y-0 left-0 w-2/3 rounded-full bg-accent" />
              <span className="absolute top-1/2 -translate-y-1/2 left-2/3 w-3 h-3 rounded-full bg-white shadow" />
            </div>
          </div>
        ))}
      </div>
      <div className="text-center text-[10px] text-white/40 mt-1.5">抽屉 · plx-glass(L1)</div>
    </div>
  )
}

function CloseupSection({ variant }: { variant: VariantKey }) {
  const chromeTier = variant === 'C' ? 'L2 折射' : 'L1 regular'
  return (
    <section className="mt-10">
      <h2 className="text-sm font-semibold text-white/85 mb-1">chrome 特写</h2>
      <p className="text-xs text-white/50 mb-4">当前变体材质:{chromeTier} —— 细看圆角 / 边缘高光 / 文本对比度</p>
      <div className="flex flex-wrap items-start gap-8">
        <div className="w-[360px]">
          <ChromeSearch variant={variant} />
          <div className="text-center text-[10px] text-white/40 mt-1.5">搜索框</div>
        </div>
        <div>
          <ChromeTabs variant={variant} />
          <div className="text-center text-[10px] text-white/40 mt-1.5">页签条</div>
        </div>
        <div className="flex gap-3">
          <ChromeArrow variant={variant} dir="left" />
          <ChromeArrow variant={variant} dir="right" />
          <div className="h-11 flex items-center"><span className="plx-glass text-white/90 text-xs px-4 py-2 rounded-full">目标页已满,无法移入</span></div>
          <div className="text-[10px] text-white/40 self-end mb-1">箭头 / 提示胶囊</div>
        </div>
        <DrawerMock />
      </div>
    </section>
  )
}

// ── 页面骨架 ───────────────────────────────────────────────────────────────

export default function PrototypeLiquidGlassPage() {
  const [params, setParams] = useSearchParams()
  const raw = params.get('variant') ?? 'A'
  const variant: VariantKey = (VARIANTS.find((v) => v.key === raw)?.key ?? 'A') as VariantKey
  const [wpId, setWpId] = useState('bing')
  const [dark, setDark] = useState(false)

  const { data: bing } = useWallpaper()
  const wallpaperUrl = wpId === 'bing' ? bing?.url : STATIC_WALLPAPERS.find((w) => w.id === wpId)?.url

  function cycle(dir: 1 | -1) {
    const i = VARIANTS.findIndex((v) => v.key === variant)
    const next = VARIANTS[(i + dir + VARIANTS.length) % VARIANTS.length].key
    setParams({ variant: next }, { replace: true })
  }

  // 键盘 ←/→ 切变体(input 聚焦时忽略)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return
      if (e.key === 'ArrowLeft') cycle(-1)
      else if (e.key === 'ArrowRight') cycle(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant])

  const activeVariant = VARIANTS.find((v) => v.key === variant)!

  return (
    <div className={dark ? 'dark' : ''}>
      <div className="min-h-screen bg-zinc-950 text-white/90 px-6 py-6 pb-28">
        {/* 页头:问题与状态 */}
        <header className="max-w-[1000px] mx-auto mb-5">
          <h1 className="text-base font-semibold">
            Liquid Glass 视觉原型 <span className="text-white/40 font-normal">(票 03 · PROTOTYPE — 一次性资产)</span>
          </h1>
          <p className="text-xs text-white/50 mt-1">
            {activeVariant.name}:{activeVariant.gist}。切换方式:底部浮动条 / ←→ 键。
            {variant === 'C' && ' 若下方 chrome 边缘无弯折与色散,说明本 Chrome 的 backdrop-filter:url() 未生效(研究票 01 §6 验证项),L2 判不可用。'}
          </p>
        </header>

        <main className="max-w-[1000px] mx-auto">
          <Mockup variant={variant} wallpaperUrl={wallpaperUrl} />

          {/* 叠放对照:研究票 01 §1 结论「禁 glass 叠 glass」与本项目图标坐 L0 页板的张力 */}
          <section className="mt-10">
            <h2 className="text-sm font-semibold text-white/85 mb-1">叠放验证 · glass on glass</h2>
            <p className="text-xs text-white/50 mb-4">
              Apple 铁律:玻璃只给功能层、禁叠放 —— 但本项目图标坐在 L0 玻璃页板上。左右同壁纸对照,右侧是否违和请目测定夺(影响 A/B/C 取舍)。
            </p>
            <div className="flex flex-wrap gap-5">
              <CompareBoard wallpaperUrl={wallpaperUrl} withPage={false} />
              <CompareBoard wallpaperUrl={wallpaperUrl} withPage={true} />
            </div>
          </section>

          <CloseupSection variant={variant} />
        </main>
      </div>

      {/* 浮动切换条(刻意高对比,明显不属于被评估的设计) */}
      <div className="plx-bar fixed bottom-4 left-1/2 -translate-x-1/2 z-50 rounded-full px-3 py-2 flex items-center gap-3 text-xs">
        <button type="button" onClick={() => cycle(-1)} className="plx-bar-btn w-6 h-6 rounded-full flex items-center justify-center" aria-label="上一变体">
          ‹
        </button>
        <span className="font-semibold whitespace-nowrap">{activeVariant.name}</span>
        <button type="button" onClick={() => cycle(1)} className="plx-bar-btn w-6 h-6 rounded-full flex items-center justify-center" aria-label="下一变体">
          ›
        </button>
        <span className="w-px h-4 bg-white/20" />
        {[
          { id: 'bing', label: '必应今日' },
          ...STATIC_WALLPAPERS,
        ].map((w) => (
          <button
            key={w.id}
            type="button"
            data-active={wpId === w.id}
            onClick={() => setWpId(w.id)}
            className="plx-bar-btn rounded-full px-2.5 py-1 whitespace-nowrap"
          >
            {w.label}
          </button>
        ))}
        <span className="w-px h-4 bg-white/20" />
        <button
          type="button"
          data-active={dark}
          onClick={() => setDark(!dark)}
          className="plx-bar-btn rounded-full px-2.5 py-1"
          title="材质明暗双值(研究票 01 §4 参数表)"
        >
          {dark ? '🌙 暗' : '☀️ 亮'}
        </button>
      </div>
    </div>
  )
}
