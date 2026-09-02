import { useId, useState } from 'react'
import { nearestIndex, type KlinePoint } from '../lib/kline'

/**
 * 收盘价迷你折线图(StockModal K 线区)。手写 SVG、无第三方图表库(契合项目极简依赖)。
 *
 * - viewBox 300×100 + preserveAspectRatio="none" 撑满容器;vector-effect 让描边不被拉宽。
 * - 全局色:末值≥首值(分时档有昨收时≥昨收)→涨色,否则跌色(--color-up/--color-down,同行情区)。
 * - 线下渐变填充 fade→透明;底部小字标注起止日期(分时档为时刻)。
 * - 悬浮:竖向 crosshair + 跟随 tooltip(日期/时刻 + 收盘价 + 涨跌%,贴边钳在容器内);
 *   涨跌锚点日线对前一根、分时对昨收(prevClose)。仅鼠标(onPointerLeave 收)。
 * - 分时档叠昨收水平虚线(涨跌锚点),并入 y 域防基准线被裁。
 */
export default function KlineChart({
  klines,
  prevClose,
  intraday,
}: {
  klines: KlinePoint[]
  /** 昨收(分时档虚线与涨跌锚点;日线档不传)。 */
  prevClose?: number | null
  /** 分时档:横轴为时刻(date 取 HH:MM),涨跌锚昨收。 */
  intraday?: boolean
}) {
  const gid = useId()
  const [hover, setHover] = useState<number | null>(null)
  const W = 300
  const H = 100
  const padY = 5

  const n = klines.length
  const closes = klines.map((k) => k.close)
  const anchor = prevClose ?? klines[0].close
  const min = Math.min(...closes, anchor)
  const max = Math.max(...closes, anchor)
  const range = max - min

  const x = (i: number) => (n === 1 ? W / 2 : (i / (n - 1)) * W)
  const y = (c: number) => {
    const ratio = range > 0 ? (c - min) / range : 0.5 // 全平→居中
    return padY + (1 - ratio) * (H - 2 * padY)
  }

  const color = klines[n - 1].close >= anchor ? 'var(--color-up)' : 'var(--color-down)'

  const linePath = klines
    .map((k, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(2)} ${y(k.close).toFixed(2)}`)
    .join(' ')
  const areaPath = `${linePath} L ${x(n - 1).toFixed(2)} ${H} L ${x(0).toFixed(2)} ${H} Z`

  const time = (d: string) => (intraday ? d.slice(11) : d)

  // 悬浮态:涨跌锚(日线前一根 / 分时昨收)+ tooltip 贴边位置(60px ≈ 半个 tooltip 估宽)。
  const hi = hover != null ? nearestIndex(hover, W, n) : null
  const hBase = hi != null ? (intraday ? prevClose : hi > 0 ? closes[hi - 1] : null) : null
  const hPct =
    hi != null && hBase ? ((closes[hi] - hBase) / hBase) * 100 : null
  const hPctCls = hPct == null ? undefined : hPct >= 0 ? 'text-up' : 'text-down'
  const tipLeft = hi != null && hover != null ? Math.min(Math.max((hover / W) * 100, 12), 88) : 0

  return (
    <div className="relative flex h-full flex-col">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="w-full flex-1"
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          setHover(((e.clientX - r.left) / r.width) * W)
        }}
        onPointerLeave={() => setHover(null)}
      >
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
        {/* 昨收基准虚线(分时档) */}
        {prevClose != null && (
          <line
            x1={0}
            x2={W}
            y1={y(prevClose)}
            y2={y(prevClose)}
            stroke="rgba(255,255,255,0.25)"
            strokeDasharray="3 4"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        )}
        {/* 悬浮 crosshair */}
        {hi != null && (
          <line
            x1={x(hi)}
            x2={x(hi)}
            y1={0}
            y2={H}
            stroke="rgba(255,255,255,0.35)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      {/* 跟随 tooltip:百分比定位 + 钳边,translateX(-50%) 居中于 crosshair */}
      {hi != null && (
        <div
          className="pointer-events-none absolute top-0 -translate-x-1/2 whitespace-nowrap rounded-md bg-black/70 px-1.5 py-0.5 font-mono text-[10px] leading-4"
          style={{ left: `${tipLeft}%` }}
        >
          <span className="text-white/50">{time(klines[hi].date)} </span>
          <span className="text-white/90">{closes[hi].toFixed(2)}</span>
          {hPct != null && (
            <span className={`ml-1 ${hPctCls}`}>
              {hPct >= 0 ? '+' : ''}
              {hPct.toFixed(2)}%
            </span>
          )}
        </div>
      )}
      {n > 1 && (
        <div className="flex justify-between pt-1 font-mono text-meta text-white/40">
          <span>{time(klines[0].date)}</span>
          <span>{time(klines[n - 1].date)}</span>
        </div>
      )}
    </div>
  )
}
