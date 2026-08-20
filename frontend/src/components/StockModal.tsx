import { useEffect } from 'react'
import { useIconData } from '../context/IconDataContext'
import { useCompanyProfile } from '../hooks/useCompanyProfile'
import { useFundamentals } from '../hooks/useFundamentals'
import { useKlines } from '../hooks/useKlines'
import KlineChart from './KlineChart'
import { formatMarketCap, isIndexSymbol, symbolToSecid, symbolToSecucode } from '../lib/companyOverview'
import { extractString } from '../lib/iconData'
import type { Icon } from '../lib/types'
import type { Quote } from '../lib/quoteParser'

/**
 * 股票详情 Modal(spec user story 11)。
 *
 * 内容:名称/符号、价格、涨跌(▲/▼ 绝对值 + 百分比)、公司概述(公司档案 + 随价估值,东财双端点
 * 纯前端取数,见 ADR-0004)、K 线(收盘价折线,东财 push2his JSONP,spec 原 Out of Scope 已落地)。
 *
 * 刷新失败降级(spec user story 15):quotesError 非空 → 行情区显示「刷新失败,重试」按钮,
 * 点击重拉 quotes(关联查询,与 useQuotes 批拉粒度一致)。单 symbol null(查询成功但无该
 * symbol)显示「—」,不算失败。
 *
 * 容器:fixed 遮罩 + 居中玻璃面板;Esc / 点遮罩关闭。编辑态进入时由父组件(DashboardPage)
 * onClose,不在本组件重复处理。
 */
export default function StockModal({
  icon,
  onClose,
}: {
  icon: Icon
  onClose: () => void
}) {
  const { quotes, quotesError, refetchQuotes } = useIconData()

  const symbol = extractString(icon.data, 'symbol')
  const name = extractString(icon.data, 'name') || symbol
  const code = symbol.replace(/^(us|sh|sz)/, '')
  const q = symbol ? quotes[symbol] ?? null : null

  // 公司概述(仅公司型;指数不渲染,见 ADR-0004)。secid/secucode 为 null 时 hook 自动禁用。
  const isIndex = isIndexSymbol(symbol)
  const secid = isIndex ? null : symbolToSecid(symbol)
  const secucode = isIndex ? null : symbolToSecucode(symbol)
  const profileQ = useCompanyProfile(secucode)
  const fundamentalsQ = useFundamentals(secid)
  const profile = profileQ.data ?? null
  const fundamentals = fundamentalsQ.data ?? null
  const overviewLoading = profileQ.isLoading || fundamentalsQ.isLoading
  const showOverview = !isIndex && (overviewLoading || !!profile || !!fundamentals)

  // K 线(收盘序列,东财 push2his):secid 对指数也成立(sh000001→1.000001),故不随 isIndex 置 null。
  const klinesQ = useKlines(symbolToSecid(symbol))
  const klines = klinesQ.data ?? []

  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`${name} 行情详情`}
    >
      {/* 遮罩:点击关闭 */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      <div className="glass-panel glass-panel-readable relative w-full max-w-lg rounded-3xl p-6">
        {/* 关闭按钮 */}
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭"
          className="absolute top-3 right-3 w-8 h-8 rounded-full bg-white/20 text-white/80 hover:bg-white/40 flex items-center justify-center"
        >
          ×
        </button>

        {/* 标题 */}
        <div className="mb-4">
          <div className="text-lg text-white/90">{name}</div>
          <div className="text-xs text-white/50 font-mono">{code}</div>
        </div>

        {/* 行情区 */}
        <div className="mb-5">
          {quotesError ? (
            <div className="flex items-center gap-3">
              <span className="text-sm text-white/60">行情刷新失败</span>
              <button
                type="button"
                onClick={refetchQuotes}
                className="border border-white/30 text-white/80 rounded-md px-2 py-0.5 text-xs hover:border-accent hover:text-accent"
              >
                刷新失败,重试
              </button>
            </div>
          ) : q ? (
            <QuoteBody q={q} />
          ) : (
            <div className="text-2xl font-mono text-white/40">—</div>
          )}
        </div>

        {/* 公司概述(仅公司型;指数只显示行情,见 ADR-0004) */}
        {showOverview && (
          <div className="mb-5">
            <div className="text-[11px] uppercase tracking-wider text-white/50 mb-2">
              公司概述
            </div>

            {/* 估值:总市值 / 市盈率(随价,push2) */}
            {fundamentals ? (
              <div className="grid grid-cols-2 gap-2 text-sm mb-2">
                <StatCell
                  label="总市值"
                  value={formatMarketCap(fundamentals.marketCap) ?? '—'}
                />
                <StatCell
                  label="市盈率"
                  value={fundamentals.pe != null ? fundamentals.pe.toFixed(2) : '—'}
                />
              </div>
            ) : overviewLoading ? (
              <div className="text-xs text-white/40 mb-2">估值加载中…</div>
            ) : null}

            {/* 公司档案:行业 + 主营 + 官网(静态,datacenter-web) */}
            {profile ? (
              <div className="rounded-xl bg-white/5 p-3 space-y-1.5 text-sm">
                {profile.industry && (
                  <div className="text-white/80">{profile.industry}</div>
                )}
                {profile.businessScope && (
                  <p className="text-white/60 text-xs leading-relaxed line-clamp-3">
                    {profile.businessScope}
                  </p>
                )}
                {profile.website && (
                  <a
                    href={withHttps(profile.website)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block text-xs text-accent hover:underline"
                  >
                    {profile.website}
                  </a>
                )}
              </div>
            ) : overviewLoading && !fundamentals ? (
              <div className="text-xs text-white/40">公司档案加载中…</div>
            ) : null}
          </div>
        )}

        {/* K 线(收盘价折线,东财 push2his,见 ADR-0004 / CONTEXT「公司概述」) */}
        <div>
          <div className="text-[11px] uppercase tracking-wider text-white/50 mb-2">
            K 线
          </div>
          <div className="h-32 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
            {klinesQ.isLoading ? (
              <div className="flex h-full items-center justify-center text-xs text-white/40">
                K 线加载中…
              </div>
            ) : klines.length > 0 ? (
              <KlineChart klines={klines} />
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-white/40">
                暂无数据
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function QuoteBody({ q }: { q: Quote }) {
  const up = q.change >= 0
  const cls = up ? 'text-up' : 'text-down'
  const arr = up ? '▲' : '▼'
  return (
    <div className="flex items-baseline gap-3">
      <span className={`font-mono text-3xl ${cls}`}>{q.price.toFixed(2)}</span>
      <span className={`font-mono text-sm ${cls}`}>
        {arr} {Math.abs(q.change).toFixed(2)} ({Math.abs(q.pct).toFixed(2)}%)
      </span>
      <span className="text-xs text-white/40 font-mono">
        昨收 {q.prev.toFixed(2)}
      </span>
    </div>
  )
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-white/10 px-3 py-1.5">
      <span className="text-white/50">{label}</span>
      <span className="font-mono text-white/80">{value}</span>
    </div>
  )
}

/** ORG_WEB 为裸域名(如 www.x.com)时补 https:// 前缀;已有协议则原样返回。 */
function withHttps(url: string): string {
  return /^https?:\/\//.test(url) ? url : `https://${url}`
}
