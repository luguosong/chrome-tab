/**
 * 天气相关类型与工具(见 ADR-0009)。后端 /api/weather 已归一化和风原始数组形态,
 * 前端只消费这里的扁平 DTO,无需 parser(对比 quoteParser/changelogParser 走前端解析的范式)。
 */

/** 用户选择的城市(后端 LocationCandidate 同形)。lat/lon 是三套天气取数的统一坐标。 */
export type WeatherLocation = {
  name: string
  adm1: string
  adm2: string
  lat: number
  lon: number
}

/** 实况(对齐后端 WeatherBundle.Now)。 */
export type WeatherNow = {
  obsTime: string
  temp: number
  feelsLike: number
  icon: string
  text: string
  humidity: number
  windDir: string
  windScale: string
  windSpeed: string
  pressure: number
  vis: number
  precip: number
}

/** 空气质量(对齐后端 WeatherBundle.Air)。后端无 AQI 标准时整个 air 为 null(字段不输出)。 */
export type WeatherAir = {
  aqi: number
  category: string
  primary: string | null
  pm2p5: number | null
  pm10: number | null
  no2: number | null
  so2: number | null
  co: number | null
  o3: number | null
}

/** 灾害预警单条(对齐后端 WeatherBundle.Alert)。color 为等级色 rgb。 */
export type WeatherAlert = {
  id: string
  senderName: string
  severity: string
  eventType: string | null
  headline: string
  description: string
  effectiveTime: string | null
  expireTime: string | null
  icon: string | null
  color: { red: number; green: number; blue: number } | null
}

/** 一个位置的三合一 bundle。实况取数失败时整个 bundle 为 null(前端该图标显示重试)。 */
export type WeatherBundle = {
  location: string
  now: WeatherNow
  air: WeatherAir | null
  alerts: WeatherAlert[]
}

/**
 * 和风天气状况图标,按 now.icon / alert.icon 直出。
 *
 * <p>历史用 {@code a.hecdn.net/img/common/icon/202106d/{code}.png}(浏览器直连官方 CDN),但该 CDN 在
 * 部分网络经代理/直连均不可达(TLS 握手失败 / 连接被拒)→ 图标裂图。改用 jsdelivr 上的官方开源图标包
 * {@code qweather-icons@1.8.0}(MIT,SVG,命名与 API code 一致),可达性好得多。</p>
 *
 * <p>彻底去外部依赖的做法是把这套 SVG 下到 {@code public/qweather-icons/} 自托管;若 jsdelivr 也不稳再这么做。</p>
 */
export const qweatherIconUrl = (code: string | null | undefined): string =>
  code ? `https://cdn.jsdelivr.net/npm/qweather-icons@1.8.0/icons/${code}.svg` : ''

/** 经纬度 → /api/weather 的 location 参数与回查 key(发送与回查用同一串,确保命中)。 */
export const locationKey = (loc: { lat: number; lon: number }): string => `${loc.lat},${loc.lon}`

/** 从图标 data 读位置(网格渲染 / Modal 回显 / 编辑预填共用)。非法返回 null。 */
export function readWeatherLocation(data: Record<string, unknown> | null): WeatherLocation | null {
  const loc = data?.location
  if (!loc || typeof loc !== 'object') return null
  const l = loc as Record<string, unknown>
  if (typeof l.lat !== 'number' || typeof l.lon !== 'number') return null
  return {
    name: typeof l.name === 'string' ? l.name : '',
    adm1: typeof l.adm1 === 'string' ? l.adm1 : '',
    adm2: typeof l.adm2 === 'string' ? l.adm2 : '',
    lat: l.lat,
    lon: l.lon,
  }
}
