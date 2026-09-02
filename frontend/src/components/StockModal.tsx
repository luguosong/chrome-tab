import { useState } from 'react'
import { useIconData } from '../context/IconDataContext'
import { useCompanyProfile } from '../hooks/useCompanyProfile'
import { useFundamentals } from '../hooks/useFundamentals'
import { useKlines } from '../hooks/useKlines'
import KlineChart from './KlineChart'
import DetailModal, { QueryPane } from './DetailModal'
import StatCell from './StatCell'
import { formatMarketCap, isIndexSymbol, symbolToSecid, symbolToSecucode } from '../lib/companyOverview'
import { extractString } from '../lib/iconData'
import { KLINE_RANGES, type KlineRange } from '../lib/kline'
import type { Icon } from '../lib/types'
import type { Quote } from '../lib/quoteParser'

/**
 * 股票详情 Modal(spec user story 11)。
 *
 * 内容:名称/符号、价格、涨跌(▲/▼ 绝对值 + 百分比)、公司概述(公司档案 + 随价估值,东财双端点
 * 纯前端取数,见 ADR-0004)、K 线(收盘价折线,东财 push2his JSONP,spec 原 Out of Scope 已落地;
 * 四档胶囊 当日|近一月|近一年|全部,按档各拉各存,当日档 1 分钟分时 + 60s 轮询,悬浮看价)。
 *
 * 刷新失败降级(spec user story 15):quotesError 非空 → 行情区显示「刷新失败,重试」按钮,
 * 点击重拉 quotes(关联查询,与 useQuotes 批拉粒度一致)。单 symbol null(查询成功但无该
 * symbol)显示「—」,不算失败。
 *
 * 容器:ModalShell 统一壳(ADR-0031)。编辑态进入时由父组件(DashboardPage)
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
  const [range, setRange] = useState<KlineRange>('1y')
  const klinesQ = useKlines(symbolToSecid(symbol), range)
  const kl = klinesQ.data ?? null

  return (
    <DetailModal
      onClose={onClose}
      ariaLabel={`${name} 行情详情`}
      width="lg"
      scroll={false}
      className="p-6"
      title={name}
      subtitle={<span className="font-mono">{code}</span>}
    >
      {/* 行情区 */}
        <div className="mb-5">
          {quotesError ? (
            <QueryPane state={{ kind: 'error', message: '行情刷新失败' }} onRetry={refetchQuotes} />
          ) : q ? (
            <QuoteBody q={q} />
          ) : (
            <div className="text-2xl font-mono text-white/40">—</div>
          )}
        </div>

        {/* 公司概述(仅公司型;指数只显示行情,见 ADR-0004) */}
        {showOverview && (
          <div className="mb-5">
            <div className="text-meta uppercase tracking-wider text-white/50 mb-2">
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
              <div className="rounded-xl bg-white/5 p-3 space-y-2 text-sm">
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

        {/* K 线(收盘价折线,东财 push2his,见 ADR-0004 / CONTEXT「公司概述」)。
            档位胶囊按档各拉各存(queryKey 含档位),当日档为 1 分钟分时 + 60s 轮询。 */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <div className="text-meta uppercase tracking-wider text-white/50">K 线</div>
            <div role="group" aria-label="K 线时间档位" className="flex gap-1">
              {(Object.keys(KLINE_RANGES) as KlineRange[]).map((key) => {
                const active = range === key
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setRange(key)}
                    className={
                      'rounded-full border px-2 py-0.5 text-meta transition ' +
                      (active
                        ? 'border-white/25 bg-white/15 text-white/90'
                        : 'border-white/15 text-white/60 hover:border-white/30 hover:text-white/85 active:border-white/40')
                    }
                  >
                    {KLINE_RANGES[key].label}
                  </button>
                )
              })}
            </div>
          </div>
          <div className="h-32 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
            {klinesQ.isLoading ? (
              <div className="flex h-full items-center justify-center text-xs text-white/40">
                K 线加载中…
              </div>
            ) : kl && kl.points.length > 0 ? (
              // 调用方零档位知识:昨收无脑传(分时档来自同响应 preKPrice,前复权口径除权日不漂移),
              // 是否消费由档位声明裁决(lib/kline.ts klineChartModel)。
              <KlineChart klines={kl.points} range={range} prevClose={kl.preClose} />
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-white/40">
                暂无数据
              </div>
            )}
          </div>
        </div>
    </DetailModal>
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

/** ORG_WEB 为裸域名(如 www.x.com)时补 https:// 前缀;已有协议则原样返回。 */
function withHttps(url: string): string {
  return /^https?:\/\//.test(url) ? url : `https://${url}`
}
