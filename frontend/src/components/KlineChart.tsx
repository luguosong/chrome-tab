import { useId } from 'react'
import type { KlinePoint } from '../lib/kline'

/**
 * 收盘价迷你折线图(StockModal K 线区)。手写 SVG、无第三方图表库(契合项目极简依赖)。
 *
 * - viewBox 300×100 + preserveAspectRatio="none" 撑满容器;vector-effect 让描边不被拉宽。
 * - 全局色:终值≥首值→涨色,否则跌色(用 CSS 变量 --color-up/--color-down,同行情区)。
 * - 线下渐变填充 fade→透明;底部小字标注起止日期(时间窗上下文)。
 */
export default function KlineChart({ klines }: { klines: KlinePoint[] }) {
  const gid = useId()
  const W = 300
  const H = 100
  const padY = 5

  const n = klines.length
  const closes = klines.map((k) => k.close)
  const min = Math.min(...closes)
  const max = Math.max(...closes)
  const range = max - min

  const x = (i: number) => (n === 1 ? W / 2 : (i / (n - 1)) * W)
  const y = (c: number) => {
    const ratio = range > 0 ? (c - min) / range : 0.5 // 全平→居中
    return padY + (1 - ratio) * (H - 2 * padY)
  }

  const color = klines[n - 1].close >= klines[0].close ? 'var(--color-up)' : 'var(--color-down)'

  const linePath = klines
    .map((k, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(2)} ${y(k.close).toFixed(2)}`)
    .join(' ')
  const areaPath = `${linePath} L ${x(n - 1).toFixed(2)} ${H} L ${x(0).toFixed(2)} ${H} Z`

  return (
    <div className="flex h-full flex-col">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full flex-1">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.35" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {n >= 2 ? (
          <>
            <path d={areaPath} fill={`url(#${gid})`} />
            <path
              d={linePath}
              fill="none"
              stroke={color}
              strokeWidth={1.5}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </>
        ) : (
          <circle cx={x(0)} cy={y(closes[0])} r={2} fill={color} />
        )}
      </svg>
      {n > 1 && (
        <div className="flex justify-between pt-1 font-mono text-[11px] text-white/40">
          <span>{klines[0].date}</span>
          <span>{klines[n - 1].date}</span>
        </div>
      )}
    </div>
  )
}
