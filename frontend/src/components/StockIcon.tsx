import { useIconData } from '../context/IconDataContext'
import { useLayoutSettings } from '../context/LayoutSettingsContext'
import { useCompanyProfile } from '../hooks/useCompanyProfile'
import { useFundamentals } from '../hooks/useFundamentals'
import { useKlines } from '../hooks/useKlines'
import { formatMarketCap, isIndexSymbol, symbolToSecid, symbolToSecucode } from '../lib/companyOverview'
import type { CompanyProfile, Fundamentals } from '../lib/companyOverview'
import { extractString } from '../lib/iconData'
import { sparklinePoints } from '../lib/kline'
import type { Quote } from '../lib/quoteParser'
import type { Icon } from '../lib/types'

/**
 * 股票图标的专属网格渲染(见 ADR-0007 / CONTEXT.md「尺寸」;ADR-0012 换肤为小组件式排版)。
 *
 * 按尺寸分三档信息密度(iOS 小组件语言:大数字、主信息、留白):
 *   - small  (1×1):名称(截断)+ 当前价
 *   - medium (2×2):名称+箭头 / 大价格 / 涨跌幅%+符号
 *   - large  (3×2):名称+符号 / 大价格+涨跌(绝对+%) / sparkline 日线迷你走势 / 市值+PE+行业
 * large 额外取公司概述与日线 K 线(东财,同 StockModal);指数型无公司概述,large 只显行情行。
 * 价格/涨跌来自 IconData 集中下发的 quotes(三档共用)。本组件只负责"网格内"视觉;
 * 由 Icon.tsx 作为外壳(拖拽/编辑角标/点击派发)在 type==='stock' 时委托调用。
 *
 * 字号随「布局设置」的 iconScale 同比缩放(各 Tier 基础 px × iconScale,1.0=默认),
 * 与 nav/changelog 图标的缩放语义一致(见 Icon.tsx SIZE_BASE_PX)。
 */
export default function StockIconBody({ icon }: { icon: Icon }) {
  const { quotes } = useIconData()
  const { iconScale } = useLayoutSettings()
  /** 基础字号 × 缩放系数;1.0 时与改造前 Tailwind text-* 的 px 完全一致。 */
  const px = (n: number) => n * iconScale
  const symbol = extractString(icon.data, 'symbol')
  const name = extractString(icon.data, 'name') || symbol
  const q = symbol ? quotes[symbol] ?? null : null

  // 公司概述与日线仅 large 时取(非 large → secid/secucode 为 null,hook 禁用,自动控成本)。
  const isLarge = icon.size === 'large'
  const company = isLarge && !isIndexSymbol(symbol)
  const profileQ = useCompanyProfile(company ? symbolToSecucode(symbol) : null)
  const fundamentalsQ = useFundamentals(company ? symbolToSecid(symbol) : null)
  const klinesQ = useKlines(isLarge ? symbolToSecid(symbol) : null)
  const profile = profileQ.data ?? null
  const fundamentals = fundamentalsQ.data ?? null

  if (icon.size === 'small') return <SmallTier name={name} q={q} px={px} />
  if (icon.size === 'medium') return <MediumTier name={name} code={shortCode(symbol)} q={q} px={px} />
  return (
    <LargeTier
      name={name}
      code={shortCode(symbol)}
      q={q}
      profile={profile}
      fundamentals={fundamentals}
      spark={sparklinePoints(klinesQ.data?.map((k) => k.close) ?? [], 100, 30)}
      px={px}
    />
  )
}

/** 去掉市场前缀的符号短码(us/sh/sz/hk),medium/large 显示用。 */
function shortCode(symbol: string): string {
  return symbol.replace(/^(us|sh|sz|hk)/i, '')
}

function tone(q: Quote): string {
  return q.change >= 0 ? 'text-up' : 'text-down'
}

/** small(1×1):名称(截断)+ 当前价。无行情时价格降级为 —。 */
function SmallTier({ name, q, px }: { name: string; q: Quote | null; px: (n: number) => number }) {
  return (
    <>
      <span className="text-white/70 truncate" style={{ fontSize: px(10) }}>{name}</span>
      <span className={`font-mono leading-none ${q ? tone(q) : 'text-white/40'}`} style={{ fontSize: px(15) }}>
        {q ? q.price.toFixed(2) : '—'}
      </span>
    </>
  )
}

/** medium(2×2):名称+箭头 / 大价格 / 涨跌幅%+符号(小组件式上下分区)。 */
function MediumTier({
  name,
  code,
  q,
  px,
}: {
  name: string
  code: string
  q: Quote | null
  px: (n: number) => number
}) {
  return (
    <div className="w-full h-full flex flex-col justify-between">
      <div className="flex items-center justify-between">
        <span className="text-white/85 font-semibold truncate" style={{ fontSize: px(11) }}>{name}</span>
        {q && <span className={tone(q)} style={{ fontSize: px(11) }}>{q.change >= 0 ? '▲' : '▼'}</span>}
      </div>
      <span className={`font-mono leading-none ${q ? tone(q) : 'text-white/40'}`} style={{ fontSize: px(24) }}>
        {q ? q.price.toFixed(2) : '—'}
      </span>
      <div className="flex items-baseline justify-between">
        {q ? (
          <span className={`font-mono ${tone(q)}`} style={{ fontSize: px(11) }}>
            {q.change >= 0 ? '+' : ''}
            {q.pct.toFixed(2)}%
          </span>
        ) : (
          <span className="font-mono text-white/40" style={{ fontSize: px(11) }}>—</span>
        )}
        <span className="text-white/55 font-mono shrink-0" style={{ fontSize: px(10) }}>{code}</span>
      </div>
    </div>
  )
}

/** large(3×2):名称+符号 / 大价格+涨跌 / sparkline / 市值+PE+行业。字段缺失则隐藏对应行。
 *  spark 为空串(取数中/失败/非 large)时整块隐藏,行情区自然接管空间。 */
function LargeTier({
  name,
  code,
  q,
  profile,
  fundamentals,
  spark,
  px,
}: {
  name: string
  code: string
  q: Quote | null
  profile: CompanyProfile | null
  fundamentals: Fundamentals | null
  spark: string
  px: (n: number) => number
}) {
  const cap = fundamentals ? formatMarketCap(fundamentals.marketCap) : null
  const hasFootRow = cap || (fundamentals != null && fundamentals.pe != null) || profile?.industry
  return (
    <div className="w-full h-full flex flex-col justify-between">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-baseline gap-1.5 min-w-0">
            <span className="text-white/90 truncate" style={{ fontSize: px(13) }}>{name}</span>
            <span className="text-white/45 font-mono shrink-0" style={{ fontSize: px(10) }}>{code}</span>
          </div>
          <div className="flex items-baseline gap-2 mt-0.5">
            <span className={`font-mono leading-none ${q ? tone(q) : 'text-white/40'}`} style={{ fontSize: px(22) }}>
              {q ? q.price.toFixed(2) : '—'}
            </span>
            {q && (
              <span className={`font-mono ${tone(q)}`} style={{ fontSize: px(11) }}>
                {q.change >= 0 ? '+' : ''}
                {q.change.toFixed(2)} ({q.pct.toFixed(2)}%)
              </span>
            )}
          </div>
        </div>
        {/* sparkline 日线迷你走势(120 根 → 归一化 100×30 viewBox,非等比拉伸铺满) */}
        {spark && (
          <svg viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden className="w-[5.5rem] h-[2rem] shrink-0">
            <polyline
              points={spark}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              className={q ? tone(q) : 'text-white/60'}
            />
          </svg>
        )}
      </div>
      {hasFootRow && (
        <div
          className="flex flex-wrap gap-x-3 text-white/55 font-mono truncate"
          style={{ fontSize: px(10) }}
        >
          {cap && <span className="truncate">市值 {cap}</span>}
          {fundamentals && fundamentals.pe != null && (
            <span className="truncate">PE {fundamentals.pe.toFixed(2)}</span>
          )}
          {profile?.industry && <span className="truncate">{profile.industry}</span>}
        </div>
      )}
    </div>
  )
}
