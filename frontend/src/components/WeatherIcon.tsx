import { useIconData } from '../context/IconDataContext'
import { useLayoutSettings } from '../context/LayoutSettingsContext'
import { locationKey, qweatherIconUrl, readWeatherLocation } from '../lib/weather'
import type { Icon } from '../lib/types'

/**
 * 天气图标的专属网格渲染(见 ADR-0009 / CONTEXT.md「天气」;ADR-0012 换肤为小组件式排版)。
 *
 * 与「自选股」同为多实例富数据类型,按尺寸分三档信息密度(iOS 小组件语言:
 * 城市 / 大温度 / 状况,主信息大字、次信息弱化):
 *   - small  (1×1):状况图标 + 温度
 *   - medium (2×2):城市名 / 大温度+状况图标 / 状况文字+湿度
 *   - large  (3×2):城市名 / 大温度+状况 / 右列状况图标+湿度+风向风力
 * 天气数据来自 IconDataContext 集中下发的 weather 批量结果(键 locationKey)。
 * 由 Icon.tsx 作为外壳在 type==='weather' 时委托调用(同 StockIconBody 范式)。
 *
 * 字号/图标随「布局设置」iconScale 同比缩放(同 StockIcon 的 px(n)=n*iconScale)。
 */
export default function WeatherIconBody({ icon }: { icon: Icon }) {
  const { weather } = useIconData()
  const { iconScale } = useLayoutSettings()
  const px = (n: number) => n * iconScale

  const loc = readWeatherLocation(icon.data)
  const now = loc ? weather[locationKey(loc)]?.now ?? null : null
  const name = loc?.name ?? ''

  const iconPx = px(icon.size === 'small' ? 22 : icon.size === 'medium' ? 26 : 32)

  // 状况图标(和风 icon,反色适配玻璃底);无数据时占位
  const condIcon = now ? (
    <img
      src={qweatherIconUrl(now.icon)}
      alt={now.text}
      style={{ width: iconPx, height: iconPx, filter: 'invert(1)' }}
    />
  ) : (
    <span className="text-white/40" style={{ fontSize: px(14) }}>···</span>
  )

  // small(1×1):状况图标 + 温度。无数据时温度降级为 —。
  if (icon.size === 'small') {
    return (
      <>
        {condIcon}
        <span
          className={`font-mono leading-none ${now ? 'text-white/90' : 'text-white/40'}`}
          style={{ fontSize: px(13) }}
        >
          {now ? `${now.temp}°` : '—'}
        </span>
      </>
    )
  }

  // medium(2×2):城市 / 大温度+图标 / 状况+湿度(上下分区)
  if (icon.size === 'medium') {
    return (
      <div className="w-full h-full flex flex-col justify-between">
        <span className="text-white/85 font-semibold truncate" style={{ fontSize: px(11) }}>
          {name}
        </span>
        <div className="flex items-center gap-1.5">
          {condIcon}
          <span
            className={`font-mono text-white/95 leading-none ${now ? '' : 'text-white/40'}`}
            style={{ fontSize: px(26) }}
          >
            {now ? `${now.temp}°` : '—'}
          </span>
        </div>
        <span className="text-white/60 truncate" style={{ fontSize: px(10) }}>
          {now ? `${now.text} · 湿度 ${now.humidity}%` : '—'}
        </span>
      </div>
    )
  }

  // large(3×2):左列城市/大温度/状况 + 右列图标/湿度/风
  return (
    <div className="w-full h-full flex items-center justify-between gap-2">
      <div className="min-w-0">
        <div className="text-white/90 truncate" style={{ fontSize: px(13) }}>{name}</div>
        <div className="flex items-baseline gap-2 mt-0.5">
          <span
            className={`font-mono text-white/95 leading-none ${now ? '' : 'text-white/40'}`}
            style={{ fontSize: px(28) }}
          >
            {now ? `${now.temp}°` : '—'}
          </span>
          <span className="text-white/70 truncate" style={{ fontSize: px(11) }}>
            {now?.text ?? ''}
          </span>
        </div>
      </div>
      <div className="text-right flex flex-col items-end gap-0.5 shrink-0">
        {condIcon}
        {now && (
          <>
            <div className="text-white/60 font-mono" style={{ fontSize: px(10) }}>
              湿度 {now.humidity}%
            </div>
            <div className="text-white/60 font-mono" style={{ fontSize: px(10) }}>
              {now.windDir}
              {now.windScale}级
            </div>
          </>
        )}
      </div>
    </div>
  )
}
