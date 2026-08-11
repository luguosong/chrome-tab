import { useEffect } from 'react'
import { useIconData } from '../context/IconDataContext'
import { extractString } from '../lib/iconData'
import type { Icon } from '../lib/types'
import type { Quote } from '../lib/quoteParser'

/**
 * 股票详情 Modal(spec user story 11)。
 *
 * 内容:名称/符号、价格、涨跌(▲/▼ 绝对值 + 百分比)、基本面字段占位、K 线区域占位
 * (K 线真实数据接入是 spec Out of Scope)。
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

      <div className="glass-panel relative w-full max-w-lg rounded-3xl p-6">
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

        {/* 基本面占位(真实字段 Out of Scope) */}
        <div className="mb-5">
          <div className="text-[11px] uppercase tracking-wider text-white/50 mb-2">
            基本面
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <PlaceholderField label="市值" />
            <PlaceholderField label="市盈率" />
            <PlaceholderField label="市净率" />
            <PlaceholderField label="股息率" />
          </div>
        </div>

        {/* K 线占位(数据接入 Out of Scope) */}
        <div>
          <div className="text-[11px] uppercase tracking-wider text-white/50 mb-2">
            K 线
          </div>
          <div className="h-32 rounded-xl border border-dashed border-white/25 flex items-center justify-center text-xs text-white/40">
            K 线数据接入中
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

function PlaceholderField({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-white/10 px-3 py-1.5">
      <span className="text-white/50">{label}</span>
      <span className="font-mono text-white/30">--</span>
    </div>
  )
}
