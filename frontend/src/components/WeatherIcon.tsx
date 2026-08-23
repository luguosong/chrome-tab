import { useIconData } from '../context/IconDataContext'
import { locationKey, qweatherIconUrl, readWeatherLocation } from '../lib/weather'
import type { Icon } from '../lib/types'
import Tile, { TilePrimary } from './Tile'

/**
 * 天气图标的专属网格渲染(见 ADR-0009;ADR-0016 单档;注记 2026-08-23b/c 块内两行):
 * 块内 = 和风状况图标(反色适配玻璃底,尺寸随块百分比缩放)+ 温度(mono 次级行)——
 * 当前状态;下方城市名行(多实例互区分的判据,取数失败也照常显示)= 这是什么。
 * 湿度/风向/空气/预警/24h/7d 预报全归详情 Modal。天气数据来自 IconDataContext 集中
 * 下发的 weather 批量结果(键 locationKey),由 Icon.tsx 作为外壳在 type==='weather'
 * 时委托调用。「上块下字」组装与字号档(ADR-0016 注记 e)归 Tile。
 */
export default function WeatherIconBody({ icon, overlay = false }: { icon: Icon; overlay?: boolean }) {
  const { weather } = useIconData()
  const loc = readWeatherLocation(icon.data)
  const now = loc ? weather[locationKey(loc)]?.now ?? null : null

  return (
    <Tile label={loc?.name || '天气'} overlay={overlay}>
      {now ? (
        <>
          <img
            src={qweatherIconUrl(now.icon)}
            alt={now.text}
            className="w-[55%] h-[55%] object-contain"
            style={{ filter: 'invert(1)' }}
          />
          <TilePrimary className="font-mono text-white/90">{now.temp}°</TilePrimary>
        </>
      ) : (
        <span className="text-white/40 text-sm leading-none">···</span>
      )}
    </Tile>
  )
}
