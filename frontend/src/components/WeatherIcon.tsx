import { useIconData } from '../context/IconDataContext'
import { hourHM, hourlyWindow, locationKey, weatherIconUrl, readWeatherLocation } from '../lib/weather'
import type { Icon } from '../lib/types'
import Tile, { TilePrimary, TileSecondary } from './Tile'

/**
 * 天气图标的专属网格渲染(见 ADR-0009;3×1 跨格,首个非 3×2 跨格尺寸,CONTEXT.md「天气」):
 * 块内 = 小时序列横排 4 格(hourlyWindow 过滤缓存滞留条目,当前小时天然居首)——首格
 * 「现在」时间标签字色提亮区分(当前小时格即实况职责),其余格 HH:mm 直取 fxTime(同 Modal 口径,不做
 * 时区换算);每格 = 时间 + 状况图标(Meteocons 彩色,深底直用无滤镜)+ 温度。hourly 缺失/空窗 → 降级
 * 实况摘要(图标 + 温度);实况也无 → ···。城市名行(多实例互区分的判据,取数失败也
 * 照常显示)= 这是什么;完整 24h/7d/空气/预警归详情 Modal(点块打开,detailEntry 缺省
 * 'block'——无滚动主体,不入 BigTile「更多」标头范式)。数据来自 IconDataContext 集中
 * 下发的 weather 批量结果(键 locationKey),由 Icon.tsx 作为外壳在 type==='weather'
 * 时委托调用。「上块下字」组装与字号档(ADR-0016 注记 e)归 Tile(fill 变体撑满画格)。
 */
export default function WeatherIconBody({ icon, overlay = false }: { icon: Icon; overlay?: boolean }) {
  const { weather } = useIconData()
  const loc = readWeatherLocation(icon.data)
  const bundle = loc ? weather[locationKey(loc)] ?? null : null
  const now = bundle?.now ?? null
  const hours = hourlyWindow(bundle?.hourly, new Date())

  return (
    // padPx=8:块内容(图标/文字)与玻璃边缘留呼吸;fill 模式 padding 直接生效,不参与钳制。
    // 名称行强制 white/90:用户暗色 labelColor 下城市名直叠壁纸不可读(报告 #11)。
    <Tile label={loc?.name || '天气'} overlay={overlay} fill padPx={8} labelColor="rgba(255,255,255,0.9)">
      {hours.length ? (
        <div className="flex w-full h-full items-stretch gap-[3%]">
          {hours.map((h, i) => (
            <div key={h.fxTime} className="flex-1 min-w-0 flex flex-col items-center justify-center gap-[4%]">
              {/* 文字行 shrink-0 + 图标 flex-1 弹性:格高不足时按「图标缩、文字刚性」分配——
                  否则 column flex 默认 shrink 会把文字行压到远小于字号的高度(线上
                  iconScale=1 时温度 14px 被压到 6px 不可读,2026-08-24)。 */}
              {/* 首格无背景衬底,「现在」靠时间标签字色提亮区分(实 vs 虚)——
                  当前小时即实况职责,不能与未来格完全同质。 */}
              <TileSecondary className={'shrink-0 ' + (i === 0 ? 'text-white/90' : 'text-white/60')}>
                {i === 0 ? '现在' : hourHM(h.fxTime)}
              </TileSecondary>
              {/* Meteocons 彩色版直用无滤镜(单色时代靠 invert 反白,彩色禁配——见 weather.ts) */}
              <img
                src={weatherIconUrl(h.icon)}
                alt={h.text}
                className="flex-1 min-h-0 w-full object-contain"
              />
              <TilePrimary className="shrink-0 font-mono text-white/90">{h.temp}°</TilePrimary>
            </div>
          ))}
        </div>
      ) : now ? (
        <>
          <img
            src={weatherIconUrl(now.icon)}
            alt={now.text}
            className="w-[55%] h-[55%] object-contain"
          />
          <TilePrimary className="font-mono text-white/90">{now.temp}°</TilePrimary>
        </>
      ) : (
        <span className="text-white/40 text-sm leading-none">···</span>
      )}
    </Tile>
  )
}
