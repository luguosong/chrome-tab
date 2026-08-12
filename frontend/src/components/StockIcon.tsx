import { useIconData } from '../context/IconDataContext'
import { useLayoutSettings } from '../context/LayoutSettingsContext'
import { useCompanyProfile } from '../hooks/useCompanyProfile'
import { useFundamentals } from '../hooks/useFundamentals'
import { formatMarketCap, isIndexSymbol, symbolToSecid, symbolToSecucode } from '../lib/companyOverview'
import type { CompanyProfile, Fundamentals } from '../lib/companyOverview'
import { extractString } from '../lib/iconData'
import type { Quote } from '../lib/quoteParser'
import type { Icon } from '../lib/types'

/**
 * 股票图标的专属网格渲染(见 ADR-0007 / CONTEXT.md「尺寸」)。
 *
 * 区别于通用 Icon 的居中"favicon+名称+摘要",股票按尺寸分三档信息密度(左对齐 ticker 卡):
 *   - small  (1×1):名称(截断)+ 当前价
 *   - medium (2×2):名称 + 涨跌箭头 / 当前价 + 涨跌幅%
 *   - large  (3×2):名称+符号+箭头 / 当前价+涨跌(绝对+%) / 总市值+PE / 行业
 * large 额外取公司概述(东财 datacenter + push2,同 StockModal);指数型无公司概述,large 只显行情行。
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

  // 公司概述仅 large 且公司型时取(指数 / 非 large → secid/secucode 为 null,hook 禁用,自动控成本)。
  const wantOverview = icon.size === 'large' && !isIndexSymbol(symbol)
  const profileQ = useCompanyProfile(wantOverview ? symbolToSecucode(symbol) : null)
  const fundamentalsQ = useFundamentals(wantOverview ? symbolToSecid(symbol) : null)
  const profile = profileQ.data ?? null
  const fundamentals = fundamentalsQ.data ?? null

  if (icon.size === 'small') return <SmallTier name={name} q={q} px={px} />
  if (icon.size === 'medium') return <MediumTier name={name} q={q} px={px} />
  return (
    <LargeTier
      name={name}
      code={shortCode(symbol)}
      q={q}
      profile={profile}
      fundamentals={fundamentals}
      px={px}
    />
  )
}

/** 去掉市场前缀的符号短码(us/sh/sz/hk),large 显示用。 */
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
      <span className={`font-mono leading-none ${q ? tone(q) : 'text-white/40'}`} style={{ fontSize: px(14) }}>
        {q ? q.price.toFixed(2) : '—'}
      </span>
    </>
  )
}

/** medium(2×2):名称+涨跌箭头 / 当前价+涨跌幅%。 */
function MediumTier({ name, q, px }: { name: string; q: Quote | null; px: (n: number) => number }) {
  return (
    <>
      <div className="flex items-center justify-between">
        <span className="text-white/90 truncate" style={{ fontSize: px(12) }}>{name}</span>
        {q && <span className={tone(q)} style={{ fontSize: px(11) }}>{q.change >= 0 ? '▲' : '▼'}</span>}
      </div>
      <div className="flex items-baseline gap-2">
        <span className={`font-mono leading-none ${q ? tone(q) : 'text-white/40'}`} style={{ fontSize: px(16) }}>
          {q ? q.price.toFixed(2) : '—'}
        </span>
        {q && (
          <span className={`font-mono ${tone(q)}`} style={{ fontSize: px(12) }}>
            {q.change >= 0 ? '+' : ''}
            {q.pct.toFixed(2)}%
          </span>
        )}
      </div>
    </>
  )
}

/** large(3×2):名称+符号+箭头 / 价格+涨跌(绝对+%) / 市值+PE / 行业。公司概述字段缺失则隐藏对应行。 */
function LargeTier({
  name,
  code,
  q,
  profile,
  fundamentals,
  px,
}: {
  name: string
  code: string
  q: Quote | null
  profile: CompanyProfile | null
  fundamentals: Fundamentals | null
  px: (n: number) => number
}) {
  const cap = fundamentals ? formatMarketCap(fundamentals.marketCap) : null
  const hasPctRow = cap || (fundamentals != null && fundamentals.pe != null)
  return (
    <div className="w-full space-y-1">
      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="text-white/90 truncate" style={{ fontSize: px(14) }}>{name}</span>
          <span className="text-white/40 font-mono shrink-0" style={{ fontSize: px(10) }}>{code}</span>
        </div>
        {q && <span className={tone(q)} style={{ fontSize: px(12) }}>{q.change >= 0 ? '▲' : '▼'}</span>}
      </div>
      <div className="flex items-baseline gap-2">
        <span className={`font-mono leading-none ${q ? tone(q) : 'text-white/40'}`} style={{ fontSize: px(20) }}>
          {q ? q.price.toFixed(2) : '—'}
        </span>
        {q && (
          <span className={`font-mono ${tone(q)}`} style={{ fontSize: px(12) }}>
            {q.change >= 0 ? '+' : ''}
            {q.change.toFixed(2)} ({q.pct.toFixed(2)}%)
          </span>
        )}
      </div>
      {hasPctRow && (
        <div className="flex flex-wrap gap-x-3 text-white/60 font-mono" style={{ fontSize: px(11) }}>
          {cap && <span>市值 {cap}</span>}
          {fundamentals && fundamentals.pe != null && (
            <span>PE {fundamentals.pe.toFixed(2)}</span>
          )}
        </div>
      )}
      {profile?.industry && (
        <div className="text-white/50 truncate" style={{ fontSize: px(11) }}>{profile.industry}</div>
      )}
    </div>
  )
}
