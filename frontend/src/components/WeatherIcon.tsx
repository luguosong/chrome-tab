import { useIconData } from '../context/IconDataContext'
import { alertBadge, locationKey, weatherIconUrl, readWeatherLocation } from '../lib/weather'
import type { Icon } from '../lib/types'
import Tile, { TilePrimary } from './Tile'

/**
 * 天气图标的专属网格渲染(见 ADR-0009;1×1 普通占格,CONTEXT.md「天气」):块内 =
 * 实况摘要——状况图标(Meteocons 彩色,深底直用无滤镜)+ 温度(mono)。城市名行
 * (多实例互区分的判据,取数失败也照常显示)= 这是什么;完整 24h/7d/空气/预警归
 * 详情 Modal(点块打开,detailEntry 'block')。数据来自 IconDataContext 集中下发的
 * weather 批量结果(键 locationKey),由 Icon.tsx 作为外壳在 type==='weather' 时
 * 委托调用。「上块下字」组装与字号档(ADR-0016 注记 e)归 Tile。
 *
 * 预警角标:存在灾害预警时块右上角显示等级色警示点(alertBadge 取最高等级,
 * 色 = 预警等级色——蓝/黄/橙/红,与 Modal AlertBody 色条同源),光晕 + 缓脉冲
 * (motion-reduce 静态,TrendingModal 呼吸点同款)使 8px 小点在玻璃深底上可辨;
 * 悬停 title 看预警名,全文归详情 Modal。实况缺失(bundle null/取数失败)→ ···。
 */
export default function WeatherIconBody({ icon, overlay = false }: { icon: Icon; overlay?: boolean }) {
  const { weather } = useIconData()
  const loc = readWeatherLocation(icon.data)
  const bundle = loc ? weather[locationKey(loc)] ?? null : null
  const now = bundle?.now ?? null
  const badge = alertBadge(bundle?.alerts ?? [])

  return (
    // 名称行强制 white/90:用户暗色 labelColor 下城市名直叠壁纸不可读(报告 #11)。
    <Tile label={loc?.name || '天气'} overlay={overlay} labelColor="rgba(255,255,255,0.9)">
      {now ? (
        /* relative 满幅层:TileFrame 自身无定位,absolute 角标若无此层会锚到外层画格
           (Icon 的 Tag 有 relative,块在画格内居中 → 偏移不可控)。层占满块 = 角标
           锚在块内右上角,内缩 6px 避开 22% 圆角弧。 */
        <div className="relative flex h-full w-full flex-col items-center justify-center gap-[4%] pb-[12%]">
          {/* pb:温度行离块底留呼吸(图标 flex-1 撑满时文字行正压在底缘,视觉贴底);
              12% 对齐 SVG 图标盒内的视觉顶留白(Meteocons viewBox 上下留白),使
              「视觉顶距 ≈ 视觉底距」达成光学居中——顶部不加 padding(SVG 盒已贴顶)。
              文字行 shrink-0 + 图标 flex-1 弹性:格高不足时按「图标缩、文字刚性」分配——
              否则 column flex 默认 shrink 会把文字行压到远小于字号的高度(线上
              iconScale=1 时温度 14px 被压到 6px 不可读,2026-08-24)。 */}
          <img
            src={weatherIconUrl(now.icon)}
            alt={now.text}
            className="flex-1 min-h-0 w-full object-contain"
          />
          <TilePrimary className="shrink-0 font-mono text-white/90">{now.temp}°</TilePrimary>
          {/* 预警角标:纯色点 + 同色光晕(iOS 状态点语汇,无描边),缓脉冲提示活跃警示
              (motion-reduce 静态,TrendingModal 呼吸点同款);悬停 title 看预警名。 */}
          {badge && (
            <span
              className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full animate-pulse motion-reduce:animate-none"
              style={{
                backgroundColor: badge.color,
                boxShadow: `0 0 6px 2px ${badge.color}`,
              }}
              title={badge.title}
            />
          )}
        </div>
      ) : (
        <span className="text-white/40 text-sm leading-none">···</span>
      )}
    </Tile>
  )
}
