import { useIconData } from '../context/IconDataContext'
import { useLayoutSettings } from '../context/LayoutSettingsContext'
import { faviconPx } from '../lib/iconLayout'
import { locationKey, qweatherIconUrl, readWeatherLocation } from '../lib/weather'
import type { Icon } from '../lib/types'
import { IconLabel, TileFrame } from './Icon'

/**
 * 天气图标的专属网格渲染(见 ADR-0009;ADR-0016 单档;注记 2026-08-23b 统一
 * 「上块下字」结构,同 StockIcon 的 c 定名称行/块内数据):块内两行——和风状况
 * 图标(反色适配玻璃底,尺寸随块百分比缩放)+ 温度(mono 次级行)= 当前状态;
 * 下方城市名行(多实例互区分的判据,取数失败也照常显示)。湿度/风向/空气/预警/
 * 24h/7d 预报全归详情 Modal。天气数据来自 IconDataContext 集中下发的 weather
 * 批量结果(键 locationKey),由 Icon.tsx 作为外壳在 type==='weather' 时委托调用。
 * 块与文字行用全类型共享的 TileFrame / IconLabel(视觉尺寸一致性的来源)。
 */
export default function WeatherIconBody({ icon, overlay = false }: { icon: Icon; overlay?: boolean }) {
  const { weather } = useIconData()
  const { iconScale } = useLayoutSettings()
  const px = (n: number) => n * iconScale

  const loc = readWeatherLocation(icon.data)
  const now = loc ? weather[locationKey(loc)]?.now ?? null : null

  return (
    <>
      <TileFrame
        favPx={faviconPx(iconScale)}
        overlay={overlay}
        className="flex-col gap-[4%] [container-type:inline-size]"
      >
        {now ? (
          <>
            <img
              src={qweatherIconUrl(now.icon)}
              alt={now.text}
              className="w-[55%] h-[55%] object-contain"
              style={{ filter: 'invert(1)' }}
            />
            <span
              className="font-mono text-white/90 leading-none max-w-full truncate"
              style={{ fontSize: `min(${px(11)}px, 16cqw)` }}
            >
              {now.temp}°
            </span>
          </>
        ) : (
          <span className="text-white/40 text-sm leading-none">···</span>
        )}
      </TileFrame>
      <IconLabel>{loc?.name || '天气'}</IconLabel>
    </>
  )
}
