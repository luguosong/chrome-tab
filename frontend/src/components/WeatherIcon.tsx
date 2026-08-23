import { useIconData } from '../context/IconDataContext'
import { useLayoutSettings } from '../context/LayoutSettingsContext'
import { faviconPx } from '../lib/iconLayout'
import { locationKey, qweatherIconUrl, readWeatherLocation } from '../lib/weather'
import type { Icon } from '../lib/types'
import { IconLabel, TileFrame } from './Icon'

/**
 * 天气图标的专属网格渲染(见 ADR-0009;ADR-0016 单档;注记 2026-08-23b 统一
 * 「上块下字」结构):块内和风状况图标(反色适配玻璃底,尺寸随块百分比缩放)+
 * 下方温度行。城市名/湿度/风向/空气/预警全归详情 Modal。天气数据来自
 * IconDataContext 集中下发的 weather 批量结果(键 locationKey),由 Icon.tsx
 * 作为外壳在 type==='weather' 时委托调用。块与文字行用全类型共享的
 * TileFrame / IconLabel(视觉尺寸与行高一致性的来源)。
 */
export default function WeatherIconBody({ icon, overlay = false }: { icon: Icon; overlay?: boolean }) {
  const { weather } = useIconData()
  const { iconScale } = useLayoutSettings()

  const loc = readWeatherLocation(icon.data)
  const now = loc ? weather[locationKey(loc)]?.now ?? null : null

  return (
    <>
      <TileFrame favPx={faviconPx(iconScale)} overlay={overlay}>
        {now ? (
          <img
            src={qweatherIconUrl(now.icon)}
            alt={now.text}
            className="w-[60%] h-[60%] object-contain"
            style={{ filter: 'invert(1)' }}
          />
        ) : (
          <span className="text-white/40 text-sm leading-none">···</span>
        )}
      </TileFrame>
      <IconLabel mono color="rgba(255,255,255,0.9)">
        {now ? `${now.temp}°` : '—'}
      </IconLabel>
    </>
  )
}
