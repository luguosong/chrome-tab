import { useIconData } from '../context/IconDataContext'
import { useLayoutSettings } from '../context/LayoutSettingsContext'
import { locationKey, qweatherIconUrl, readWeatherLocation } from '../lib/weather'
import type { Icon } from '../lib/types'

/**
 * 天气图标的专属网格渲染(见 ADR-0009 / CONTEXT.md「天气」)。
 *
 * 与「自选股」同为多实例富数据类型,按尺寸分三档信息密度(左对齐卡):
 *   - small  (1×1):天气状况图标 + 温度
 *   - medium (2×2):城市名 / 状况图标 + 温度
 *   - large  (3×2):城市名 / 状况图标 + 温度 + 文字 / 湿度 + 风向风力
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

  const iconPx = px(icon.size === 'small' ? 22 : icon.size === 'medium' ? 28 : 34)

  // small(1×1):状况图标 + 温度。无数据时温度降级为 —。
  if (icon.size === 'small') {
    return (
      <>
        {now ? (
          <img
            src={qweatherIconUrl(now.icon)}
            alt={now.text}
            style={{ width: iconPx, height: iconPx, filter: 'invert(1)' }}
          />
        ) : (
          <span className="text-white/40" style={{ fontSize: px(16) }}>
            ···
          </span>
        )}
        <span
          className={`font-mono leading-none ${now ? 'text-white/90' : 'text-white/40'}`}
          style={{ fontSize: px(13) }}
        >
          {now ? `${now.temp}°` : '—'}
        </span>
      </>
    )
  }

  // medium(2×2)/ large(3×2)
  return (
    <div className="w-full space-y-1">
      <span
        className="text-white/90 truncate block"
        style={{ fontSize: px(icon.size === 'large' ? 14 : 12) }}
      >
        {name}
      </span>
      <div className="flex items-center gap-2">
        {now ? (
          <img
            src={qweatherIconUrl(now.icon)}
            alt={now.text}
            style={{ width: iconPx, height: iconPx, filter: 'invert(1)' }}
          />
        ) : (
          <span className="text-white/40" style={{ fontSize: px(14) }}>
            ···
          </span>
        )}
        <span
          className={`font-mono leading-none ${now ? 'text-white/90' : 'text-white/40'}`}
          style={{ fontSize: px(icon.size === 'large' ? 22 : 16) }}
        >
          {now ? `${now.temp}°` : '—'}
        </span>
        {now && icon.size === 'large' && (
          <span className="text-white/60 truncate" style={{ fontSize: px(11) }}>
            {now.text}
          </span>
        )}
      </div>
      {icon.size === 'large' && now && (
        <div className="text-white/50 font-mono" style={{ fontSize: px(11) }}>
          湿度 {now.humidity}% · {now.windDir}
          {now.windScale}级
        </div>
      )}
    </div>
  )
}
