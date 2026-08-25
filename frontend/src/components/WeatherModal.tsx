import { useEffect, type ReactNode } from 'react'
import { useIconData } from '../context/IconDataContext'
import { hourHM, locationKey, weatherIconUrl, readWeatherLocation, type WeatherAir, type WeatherAlert, type WeatherDay, type WeatherHour, type WeatherNow } from '../lib/weather'
import type { Icon } from '../lib/types'

/**
 * 天气详情 Modal(见 ADR-0009)。实况 / 24 小时预报(水平滚动)/ 7 天预报 / 空气质量 / 灾害预警
 * (预报/空气/预警段各自随数据隐藏——后端对应端点失败时省略字段)。
 *
 * 刷新失败降级(同 StockModal):weatherError 或 bundle 缺失(取数失败→后端 null)→ 顶部「刷新失败,重试」。
 * 数据来自 IconDataContext 集中下发的 weather(键 locationKey),点击重试 refetchWeather(批拉粒度)。
 *
 * 容器:fixed 遮罩 + 居中玻璃面板;Esc / 点遮罩关闭。
 */
export default function WeatherModal({
  icon,
  onClose,
}: {
  icon: Icon
  onClose: () => void
}) {
  const { weather, weatherError, refetchWeather } = useIconData()

  const loc = readWeatherLocation(icon.data)
  const key = loc ? locationKey(loc) : ''
  const bundle = key ? weather[key] ?? null : null
  const now = bundle?.now ?? null
  const air = bundle?.air ?? null
  const hourly = bundle?.hourly ?? null
  const daily = bundle?.daily ?? null
  const alerts = bundle?.alerts ?? []
  const name = loc?.name ?? '天气'

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const failed = weatherError || (key !== '' && bundle === null)

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`${name} 天气详情`}
    >
      <div className="absolute inset-0 bg-black/50 animate-fade-in" onClick={onClose} />

      {/* max-h + 滚动:预警/逐日多时小屏溢出(族内既有模式) */}
      <div className="glass-panel glass-panel-readable relative w-full max-w-lg rounded-3xl p-6 max-h-[80vh] overflow-y-auto modal-scroll animate-pop-in">
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭"
          className="absolute top-3 right-3 w-8 h-8 rounded-full bg-white/20 text-white/80 hover:bg-white/40 flex items-center justify-center transition-colors focus-visible:outline-2 focus-visible:outline-white/60"
        >
          ×
        </button>

        {/* 标题:城市 + 行政区划 */}
        <div className="mb-4">
          <div className="text-lg text-white/90">{name}</div>
          {loc && (
            <div className="text-xs text-white/50">
              {[loc.adm1, loc.adm2].filter(Boolean).join(' · ')}
            </div>
          )}
        </div>

        {/* 实况 */}
        {failed ? (
          <div className="flex items-center gap-3 mb-4">
            <span className="text-sm text-white/60">天气刷新失败</span>
            <button
              type="button"
              onClick={refetchWeather}
              className="rounded-full border border-white/30 px-3 py-1.5 min-h-8 text-xs text-white/80 hover:border-accent hover:text-accent active:bg-white/20 transition-colors focus-visible:outline-2 focus-visible:outline-white/60"
            >
              刷新失败,重试
            </button>
          </div>
        ) : now ? (
          <NowBody now={now} />
        ) : (
          <div className="text-xs text-white/40 mb-4">加载中…</div>
        )}

        {/* 24 小时预报(后端 24h 端点失败时省略 hourly,该段隐藏) */}
        {hourly && hourly.length > 0 && (
          <div className="mb-4">
            <SectionTitle>24 小时预报</SectionTitle>
            <div className="flex gap-3 overflow-x-auto pb-1">
              {hourly.map((h) => (
                <HourCell key={h.fxTime} h={h} />
              ))}
            </div>
          </div>
        )}

        {/* 7 天预报(后端 7d 端点失败时省略 daily,该段隐藏) */}
        {daily && daily.length > 0 && (
          <div className="mb-4">
            <SectionTitle>7 天预报</SectionTitle>
            <div className="space-y-2">
              {daily.map((d, i) => (
                <DayRow key={d.fxDate} d={d} label={dayLabel(d.fxDate, i)} />
              ))}
            </div>
          </div>
        )}

        {/* 空气质量(无 AQI 数据则后端 air=null,该段隐藏) */}
        {air && (
          <div className="mb-4">
            <SectionTitle>空气质量</SectionTitle>
            <AirBody air={air} />
          </div>
        )}

        {/* 灾害预警(无预警 alerts=[],该段隐藏) */}
        {alerts.length > 0 && (
          <div>
            <SectionTitle>灾害预警</SectionTitle>
            <div className="space-y-2">
              {alerts.map((a) => (
                <AlertBody key={a.id} a={a} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/** 小时预报单元:时刻(ISO 串直取 HH:mm,不做时区换算——fxTime 即当地时间)+ 图标 + 温度。 */
function HourCell({ h }: { h: WeatherHour }) {
  return (
    <div className="flex flex-col items-center gap-1 shrink-0">
      <span className="text-xs text-white/60">{hourHM(h.fxTime)}</span>
      <img
        src={weatherIconUrl(h.icon)}
        alt={h.text}
        style={{ width: 26, height: 26 }}
      />
      <span className="font-mono text-sm text-white/85">{h.temp}°</span>
    </div>
  )
}

/** 逐日预报行:标签(今天/周X)+ 昼间图标 + 状况 + 温度区间。 */
function DayRow({ d, label }: { d: WeatherDay; label: string }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-12 shrink-0 text-white/70">{label}</span>
      <img
        src={weatherIconUrl(d.iconDay)}
        alt={d.textDay}
        style={{ width: 22, height: 22 }}
      />
      <span className="flex-1 truncate text-white/70">{d.textDay}</span>
      <span className="font-mono text-white/85">
        {d.tempMin}° ~ {d.tempMax}°
      </span>
    </div>
  )
}

/** fxDate("YYYY-MM-DD") → 首行「今天」,其余周X;解析失败回落 MM-DD。 */
function dayLabel(fxDate: string, index: number): string {
  if (index === 0) return '今天'
  const d = new Date(fxDate)
  return Number.isNaN(d.getTime()) ? fxDate.slice(5) : `周${'日一二三四五六'[d.getUTCDay()]}`
}

/** 实况:大温度 + 状况图标 + 文字 + 体感/湿度/风/气压/能见度 小网格。 */
function NowBody({ now }: { now: WeatherNow }) {
  return (
    <div className="mb-4">
      <div className="flex items-center gap-3 mb-3">
        <img
          src={weatherIconUrl(now.icon)}
          alt={now.text}
          style={{ width: 48, height: 48 }}
        />
        <span className="font-mono text-4xl text-white/90 leading-none">{now.temp}°</span>
        <span className="text-white/70 text-sm">{now.text}</span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-sm">
        <StatCell label="体感" value={`${now.feelsLike}°`} />
        <StatCell label="湿度" value={`${now.humidity}%`} />
        <StatCell label="降水" value={`${now.precip}mm`} />
        <StatCell label="风向" value={`${now.windDir}${now.windScale}级`} />
        <StatCell label="气压" value={`${now.pressure}hPa`} />
        <StatCell label="能见度" value={`${now.vis}km`} />
      </div>
    </div>
  )
}

/** 空气质量:AQI + 等级 + 污染物浓度(按 AQI 等级着色 AQI 数字)。 */
function AirBody({ air }: { air: WeatherAir }) {
  return (
    <div>
      <div className="flex items-center gap-3 mb-2">
        <span className="font-mono text-2xl text-white/90">{air.aqi}</span>
        <span className="text-white/70 text-sm">{air.category}</span>
        {air.primary && <span className="text-white/40 text-xs">首要 {air.primary}</span>}
      </div>
      <div className="grid grid-cols-3 gap-2 text-sm">
        <StatCell label="PM2.5" value={fmt(air.pm2p5)} />
        <StatCell label="PM10" value={fmt(air.pm10)} />
        <StatCell label="O₃" value={fmt(air.o3)} />
        <StatCell label="NO₂" value={fmt(air.no2)} />
        <StatCell label="SO₂" value={fmt(air.so2)} />
        <StatCell label="CO" value={fmt(air.co)} />
      </div>
    </div>
  )
}

/** 灾害预警单条:等级色条 + 标题 + 类型/严重性 + 详情文本。 */
function AlertBody({ a }: { a: WeatherAlert }) {
  const barColor = a.color ? `rgb(${a.color.red},${a.color.green},${a.color.blue})` : 'rgb(255,80,80)'
  return (
    <div
      className="rounded-xl p-3"
      style={{ backgroundColor: `rgba(${a.color?.red ?? 255},${a.color?.green ?? 80},${a.color?.blue ?? 80},0.15)` }}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="inline-block w-1.5 h-4 rounded" style={{ backgroundColor: barColor }} />
        <span className="text-white/90 text-sm font-medium">{a.headline || a.eventType || '预警'}</span>
      </div>
      {(a.eventType || a.severity) && (
        <div className="text-white/50 text-xs mb-1">
          {[a.eventType, a.severity].filter(Boolean).join(' · ')}
        </div>
      )}
      {a.description && (
        <p className="text-white/70 text-xs leading-relaxed whitespace-pre-line">{a.description}</p>
      )}
    </div>
  )
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <div className="text-[11px] uppercase tracking-wider text-white/50 mb-2">{children}</div>
  )
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-white/10 px-3 py-2">
      <span className="text-white/50">{label}</span>
      <span className="font-mono text-white/80">{value}</span>
    </div>
  )
}

/** 污染物浓度:null → '—',否则原值(已是数值)。 */
function fmt(v: number | null): string {
  return v == null ? '—' : String(v)
}
