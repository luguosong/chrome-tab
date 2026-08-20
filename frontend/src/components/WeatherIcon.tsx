import { useIconData } from '../context/IconDataContext'
import { useLayoutSettings } from '../context/LayoutSettingsContext'
import { locationKey, qweatherIconUrl, readWeatherLocation } from '../lib/weather'
import type { Icon } from '../lib/types'

/**
 * 天气图标的专属网格渲染(见 ADR-0009;ADR-0016 单档极简:1×1 只显示 状况图标 + 温度)。
 * 城市名在详情 Modal,湿度/风向/空气/预警亦归 Modal。
 * 天气数据来自 IconDataContext 集中下发的 weather 批量结果(键 locationKey)。
 * 由 Icon.tsx 作为外壳在 type==='weather' 时委托调用(同 StockIconBody 范式)。
 *
 * 字号/图标随「布局设置」iconScale 同比缩放(px(n)=n*iconScale,1.5=默认)。
 */
export default function WeatherIconBody({ icon }: { icon: Icon }) {
  const { weather } = useIconData()
  const { iconScale } = useLayoutSettings()
  const px = (n: number) => n * iconScale

  const loc = readWeatherLocation(icon.data)
  const now = loc ? weather[locationKey(loc)]?.now ?? null : null

  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-0.5">
      {/* 状况图标(和风 icon,反色适配玻璃底);无数据时占位 */}
      {now ? (
        <img
          src={qweatherIconUrl(now.icon)}
          alt={now.text}
          style={{ width: px(22), height: px(22), filter: 'invert(1)' }}
        />
      ) : (
        <span className="text-white/40" style={{ fontSize: px(14) }}>···</span>
      )}
      <span
        className={`font-mono leading-none ${now ? 'text-white/90' : 'text-white/40'}`}
        style={{ fontSize: px(13) }}
      >
        {now ? `${now.temp}°` : '—'}
      </span>
    </div>
  )
}
