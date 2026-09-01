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

/** 小时预报单条(对齐后端 WeatherBundle.Hourly;展示子集:时间/温度/状况)。 */
export type WeatherHour = {
  fxTime: string
  temp: number
  icon: string
  text: string
}

/** 逐日预报单条(对齐后端 WeatherBundle.Daily;展示子集:日期/温度区间/昼间状况)。 */
export type WeatherDay = {
  fxDate: string
  tempMax: number
  tempMin: number
  iconDay: string
  textDay: string
}

/** 一个位置的 bundle(实况必在;空气/预报取数失败时对应字段运行时缺失)。实况取数失败时整个 bundle 为 null(前端该图标显示重试)。 */
export type WeatherBundle = {
  location: string
  now: WeatherNow
  air: WeatherAir | null
  alerts: WeatherAlert[]
  hourly?: WeatherHour[]
  daily?: WeatherDay[]
}

/**
 * 和风 icon code → Meteocons 图标名。精确项覆盖昼夜与特殊现象;其余 3xx 归 rain、
 * 4xx 归 snow、未知归 not-available(兜底逻辑在 {@link weatherIconUrl})。code 本身
 * 带昼夜(100 晴 / 150 晴夜),映射天然区分昼夜,无需感知时间。
 */
const METEOCON: Record<string, string> = {
  '100': 'clear-day', '150': 'clear-night',
  '101': 'partly-cloudy-day', '151': 'partly-cloudy-night',
  '102': 'partly-cloudy-day', '152': 'partly-cloudy-night',
  '103': 'partly-cloudy-day', '153': 'partly-cloudy-night',
  '104': 'cloudy',
  '302': 'thunderstorms-day-rain', '303': 'thunderstorms-day-rain',
  '304': 'hail',
  '309': 'drizzle', '313': 'sleet',
  '404': 'sleet', '405': 'sleet', '406': 'sleet', '456': 'sleet',
  '500': 'mist', '501': 'fog', '509': 'fog', '510': 'fog',
  '502': 'haze', '511': 'haze', '512': 'haze', '513': 'haze',
  '503': 'dust', '504': 'dust', '507': 'dust-wind', '508': 'dust-wind',
  '900': 'thermometer-warmer', '901': 'thermometer-colder',
  '999': 'not-available',
}

/**
 * 天气状况图标 URL,按 now.icon / h.icon / d.iconDay 经映射直出。三段演进:
 * ①官方 CDN 彩色 PNG(a.hecdn.net)部分网络经代理/直连均不可达 → 裂图,弃;
 * ②qweather-icons 单色线稿 + CSS invert(1) 反白(2026-08-25 前),但单色丢掉
 * 「太阳黄/雨蓝/夜深蓝」的色相辨识,4 格小时序列 20px 级小图标纯形状辨识吃力;
 * ③现用 Meteocons(basmilius/weather-icons@2.0.0,LGPL,fill 彩色版)——高明度配色
 * 为深色天气 app 而设计,玻璃深底直用无滤镜;彩色 SVG 禁配 invert(会把亮黄反成紫)。
 * 和风开源包(npm 与 qwd/Icons)从未有彩色版,官方彩色仅存于不可达的 a.hecdn.net,
 * 彩色只能换体系并维护上面的映射。SVG 内嵌 45s 级 SMIL 微动画(光线缓旋),<img> 直引即活。
 * 彻底去外部依赖的做法是把这套 SVG 下到 {@code public/meteocons/} 自托管;若 jsdelivr 也不稳再这么做。
 */
export function weatherIconUrl(code: string | null | undefined): string {
  if (!code) return ''
  const name =
    METEOCON[code] ?? (code.startsWith('3') ? 'rain' : code.startsWith('4') ? 'snow' : 'not-available')
  return `https://cdn.jsdelivr.net/gh/basmilius/weather-icons@2.0.0/production/fill/all/${name}.svg`
}

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

/**
 * 小时条目显示时刻:ISO 串直取 HH:mm,不做时区换算——fxTime 即城市当地时间
 * (详情 Modal 24h 序列的口径)。
 */
export const hourHM = (fxTime: string): string => fxTime?.slice(11, 16)

/** CAP 严重性权重(和风 severity 取值):等级排序用,未知值给最低——宁显示不漏。 */
const SEVERITY_RANK: Record<string, number> = { Minor: 1, Moderate: 2, Severe: 3, Extreme: 4 }

/** 预警缺 color 时的等级标准色(和风文档口径);与 Modal AlertBody 兜底红同源。 */
const SEVERITY_COLOR: Record<string, string> = {
  Minor: 'rgb(0,153,255)',
  Moderate: 'rgb(255,170,0)',
  Severe: 'rgb(255,102,0)',
  Extreme: 'rgb(255,0,0)',
}

/**
 * 1×1 天气图标右上角的预警角标(见 CONTEXT.md「天气」):取 severity 最高的一条
 * (多条预警并存时按最高等级示警),color = 预警等级色(color 字段直用,缺失按
 * severity 查标准色,全空兜底红);title = headline(悬停看预警名,全文归详情
 * Modal)。无预警返回 null。纯函数,Vitest 直测。
 */
export function alertBadge(alerts: WeatherAlert[]): { color: string; title: string } | null {
  if (!alerts.length) return null
  const top = alerts.reduce((a, b) =>
    (SEVERITY_RANK[b.severity ?? ''] ?? 1) > (SEVERITY_RANK[a.severity ?? ''] ?? 1) ? b : a,
  )
  const color = top.color
    ? `rgb(${top.color.red},${top.color.green},${top.color.blue})`
    : SEVERITY_COLOR[top.severity ?? ''] ?? 'rgb(255,80,80)'
  return { color, title: top.headline || top.eventType || '灾害预警' }
}
