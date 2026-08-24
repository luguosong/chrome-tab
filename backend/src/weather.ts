import { Hono } from 'hono'
import { asRec, str, type Rec } from './common'
import { TtlCache } from './common'

/**
 * 天气后端代理(ADR-0009,契约 §7)。五端点 per 位置:实况 /v7/weather/now、空气
 * /airquality/v1/current、预警 /weatheralert/v1/current、小时预报 /v7/weather/24h、
 * 逐日预报 /v7/weather/7d;城市搜索走 GeoAPI。
 *
 * 经纬度入参顺序(和风反直觉点,极易错):v7 端点(now/24h/7d)的 location=lon,lat(经度在前);
 * v1 空气/预警路径 /{lat}/{lon}(纬度在前)。经纬度统一 2 位小数(和风精度上限)。
 *
 * 缓存:按 (canonicalKey, endpoint) 内存 TTL——实况 10min、空气 30min、预警 5min、预报(24h/7d)30min;
 * 仅缓存成功结果,失败不缓存(重试可再打上游)。降级:实况失败 → 整 bundle 为 null(前端该图标显示重试);
 * 空气/预警/预报失败 → 各自 null/空/省略,不影响实况展示。Key/host 未配置 → 抛错走 500「服务器错误」。
 *
 * gzip:和风对所有响应无条件 gzip。Java 侧需 GzipDecompressingInterceptor(JDK HttpClient 不解压);
 * Node fetch 按规范自动解压并摘 Content-Encoding/Content-Length,无需处理。
 */

const NOW_TTL_MS = 10 * 60_000
const AIR_TTL_MS = 30 * 60_000
const ALERT_TTL_MS = 5 * 60_000
const HOURLY_TTL_MS = 30 * 60_000
const DAILY_TTL_MS = 30 * 60_000

// ── wire DTO(契约 §7;air 及其内部字段 NON_NULL:null 序列化时省略,不得置 null)──────

export interface WeatherNowDto {
  obsTime: string | null
  temp: number
  feelsLike: number
  icon: string | null
  text: string | null
  humidity: number
  windDir: string | null
  windScale: string | null
  windSpeed: string | null
  pressure: number
  vis: number
  precip: number
}

export interface WeatherAirDto {
  aqi: number
  category: string | null
  primary?: string | null
  pm2p5?: number | null
  pm10?: number | null
  no2?: number | null
  so2?: number | null
  co?: number | null
  o3?: number | null
}

export interface WeatherAlertDto {
  id: string | null
  senderName: string | null
  severity: string | null
  eventType: string | null
  headline: string | null
  description: string | null
  effectiveTime: string | null
  expireTime: string | null
  icon: string | null
  color: { red: number; green: number; blue: number } | null
}

export interface LocationCandidateDto {
  name: string | null
  adm1: string | null
  adm2: string | null
  lat: number
  lon: number
}

/** 小时预报单条(24h,展示字段子集:时间/温度/状况)。 */
export interface WeatherHourlyDto {
  fxTime: string | null
  temp: number
  icon: string | null
  text: string | null
}

/** 逐日预报单条(7d,展示字段子集:日期/温度区间/昼间状况)。 */
export interface WeatherDailyDto {
  fxDate: string | null
  tempMax: number
  tempMin: number
  iconDay: string | null
  textDay: string | null
}

export interface WeatherBundleDto {
  /** 规范化 "lat,lon"(2 位小数)缓存键,与响应 map 的原始串键不同表示(契约冻结) */
  location: string
  now: WeatherNowDto
  /** null 时整个字段省略(NON_NULL) */
  air?: WeatherAirDto
  alerts: WeatherAlertDto[]
  /** 取数失败时整个字段省略(同 air 降级) */
  hourly?: WeatherHourlyDto[]
  daily?: WeatherDailyDto[]
}

export interface WeatherConfig {
  apiKey: string
  apiHost: string
  lang?: string
}

// ── 防御式读取(v7 字段多为字符串、v1 多为数值,数值读取两者皆收;
//    asRec/str 为三域同形,已提至 common.ts,此处留数值族私有)──────────────────

const num = (m: Rec, k: string): number | null => {
  const s = str(m, k)
  if (s === null || s.trim() === '') return null
  const n = Number(s)
  return Number.isNaN(n) ? null : n
}
const int = (m: Rec, k: string): number => {
  const n = num(m, k)
  return n === null ? 0 : Math.round(n)
}
const dbl = (m: Rec, k: string): number => num(m, k) ?? 0
const rec = (m: Rec, k: string): Rec => asRec(m?.[k])
const arr = (m: Rec, k: string): unknown[] => {
  const v = m?.[k]
  return Array.isArray(v) ? v : []
}

// ── 纯解析(照搬 Java WeatherParser 语义,可直测)────────────────────────────────

/** "lat,lon" → [lat, lon];非法格式返回 null。逗号不拆、空段/非数字拒绝。 */
export function parseLatLon(raw: string): [number, number] | null {
  const parts = raw.split(',')
  if (parts.length !== 2) return null
  const a = parts[0]!.trim()
  const b = parts[1]!.trim()
  const la = Number(a)
  const lo = Number(b)
  if (a === '' || b === '' || !Number.isFinite(la) || !Number.isFinite(lo)) return null
  return [la, lo]
}

/** 实况:code != 200 或缺 now 抛异常(调用方据此判该位置取数失败 → 整 bundle null)。 */
export function parseNow(resp: unknown): WeatherNowDto {
  const r = asRec(resp)
  if (str(r, 'code') !== '200') throw new Error('weather-now 响应非 200')
  const n = rec(r, 'now')
  if (!n) throw new Error('weather-now 缺 now')
  return {
    obsTime: str(n, 'obsTime'),
    temp: int(n, 'temp'),
    feelsLike: int(n, 'feelsLike'),
    icon: str(n, 'icon'),
    text: str(n, 'text'),
    humidity: int(n, 'humidity'),
    windDir: str(n, 'windDir'),
    windScale: str(n, 'windScale'),
    windSpeed: str(n, 'windSpeed'),
    pressure: int(n, 'pressure'),
    vis: int(n, 'vis'),
    precip: dbl(n, 'precip'),
  }
}

/** 空气质量:选和风通用 AQI(qaqi),否则取首个 index;无任何 index 返回 null。 */
export function parseAir(resp: unknown): WeatherAirDto | null {
  const r = asRec(resp)
  const indexes = arr(r, 'indexes')
  let first: Rec
  let qaqi: Rec
  for (const o of indexes) {
    const m = asRec(o)
    if (!m) continue
    if (!first) first = m
    if (str(m, 'code') === 'qaqi') qaqi = m
  }
  const idx = qaqi ?? first
  if (!idx) return null
  const primary = rec(idx, 'primaryPollutant')
  const polls = arr(r, 'pollutants')
  return {
    aqi: int(idx, 'aqi'),
    category: str(idx, 'category'),
    primary: primary ? str(primary, 'code') : null,
    pm2p5: pollutant(polls, 'pm2p5'),
    pm10: pollutant(polls, 'pm10'),
    no2: pollutant(polls, 'no2'),
    so2: pollutant(polls, 'so2'),
    co: pollutant(polls, 'co'),
    o3: pollutant(polls, 'o3'),
  }
}

/** 预警:metadata.zeroResult=true 或 alerts 空时返回空列表(无预警,非失败)。 */
export function parseAlerts(resp: unknown): WeatherAlertDto[] {
  const r = asRec(resp)
  const meta = rec(r, 'metadata')
  if (meta?.zeroResult === true) return []
  const out: WeatherAlertDto[] = []
  for (const o of arr(r, 'alerts')) {
    const m = asRec(o)
    if (!m) continue
    const et = rec(m, 'eventType')
    const col = rec(m, 'color')
    out.push({
      id: str(m, 'id'),
      senderName: str(m, 'senderName'),
      severity: str(m, 'severity'),
      eventType: et ? str(et, 'name') : null,
      headline: str(m, 'headline'),
      description: str(m, 'description'),
      effectiveTime: str(m, 'effectiveTime'),
      expireTime: str(m, 'expireTime'),
      icon: str(m, 'icon'),
      color: col ? { red: int(col, 'red'), green: int(col, 'green'), blue: int(col, 'blue') } : null,
    })
  }
  return out
}

/** 城市搜索:code != 200 返回空列表。 */
export function parseLocations(resp: unknown): LocationCandidateDto[] {
  const r = asRec(resp)
  if (str(r, 'code') !== '200') return []
  const out: LocationCandidateDto[] = []
  for (const o of arr(r, 'location')) {
    const m = asRec(o)
    if (!m) continue
    out.push({
      name: str(m, 'name'),
      adm1: str(m, 'adm1'),
      adm2: str(m, 'adm2'),
      lat: dbl(m, 'lat'),
      lon: dbl(m, 'lon'),
    })
  }
  return out
}

/** 小时预报:code != 200 或缺 hourly 抛(调用方据此省略 hourly 段)。 */
export function parseHourly(resp: unknown): WeatherHourlyDto[] {
  const r = asRec(resp)
  if (str(r, 'code') !== '200') throw new Error('weather-24h 响应非 200')
  const arrV = arr(r, 'hourly')
  if (!arrV.length) throw new Error('weather-24h 缺 hourly')
  const out: WeatherHourlyDto[] = []
  for (const o of arrV) {
    const m = asRec(o)
    if (!m) continue
    out.push({ fxTime: str(m, 'fxTime'), temp: int(m, 'temp'), icon: str(m, 'icon'), text: str(m, 'text') })
  }
  return out
}

/** 逐日预报:code != 200 或缺 daily 抛(调用方据此省略 daily 段)。 */
export function parseDaily(resp: unknown): WeatherDailyDto[] {
  const r = asRec(resp)
  if (str(r, 'code') !== '200') throw new Error('weather-7d 响应非 200')
  const arrV = arr(r, 'daily')
  if (!arrV.length) throw new Error('weather-7d 缺 daily')
  const out: WeatherDailyDto[] = []
  for (const o of arrV) {
    const m = asRec(o)
    if (!m) continue
    out.push({
      fxDate: str(m, 'fxDate'),
      tempMax: int(m, 'tempMax'),
      tempMin: int(m, 'tempMin'),
      iconDay: str(m, 'iconDay'),
      textDay: str(m, 'textDay'),
    })
  }
  return out
}

/** 从 pollutants[] 按 code 取浓度 value(so2 等可能缺失 → null)。 */
function pollutant(pollutants: unknown[], code: string): number | null {
  for (const o of pollutants) {
    const m = asRec(o)
    if (m && str(m, 'code') === code) return num(rec(m, 'concentration'), 'value')
  }
  return null
}

// ── 服务(HTTP + 缓存)──────────────────────────────────────────────────────────

/**
 * 由配置主机解析 baseUrl。未配置 → 占位主机(因 requireConfigured 先抛,不会真请求)。
 * 历史 bug:api-host 曾是无 scheme 裸主机 → JDK HttpClient 抛 "URI with undefined scheme",
 * 故对裸主机统一补 https://。
 */
export function baseUrlFor(apiHost: string): string {
  const host = apiHost.trim()
  if (!host) return 'https://devapi.qweatherapi.com'
  return /^https?:\/\//.test(host) ? host : `https://${host}`
}

/** NON_NULL 语义:Air null 字段序列化省略(契约冻结:前端声明 | null 但运行时收 undefined) */
function omitNulls<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined)) as T
}

const fmt = (v: number): string => v.toFixed(2)

export function createWeatherService(cfg: WeatherConfig) {
  const { apiKey, apiHost } = cfg
  const lang = cfg.lang ?? 'zh-hans'
  const base = baseUrlFor(apiHost)
  const nowCache = new TtlCache<WeatherNowDto>()
  const airCache = new TtlCache<WeatherAirDto | null>()
  const alertCache = new TtlCache<WeatherAlertDto[]>()
  const hourlyCache = new TtlCache<WeatherHourlyDto[]>()
  const dailyCache = new TtlCache<WeatherDailyDto[]>()

  function requireConfigured() {
    if (!apiKey.trim() || !apiHost.trim()) {
      throw new Error('天气服务未配置(QWEATHER_API_KEY / QWEATHER_API_HOST 缺失)')
    }
  }

  /** 对齐 RestClient.retrieve():非 2xx 抛(4xx 错误体排障 + 降级路径统一走异常) */
  async function getJson(path: string, params: Record<string, string>): Promise<unknown> {
    const url = new URL(path, base)
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
    const res = await fetch(url, { headers: { 'X-QW-Api-Key': apiKey } })
    if (!res.ok) throw new Error(`和风上游 HTTP ${res.status}`)
    return res.json()
  }

  /** 城市搜索(GeoAPI),供新增抽屉城市选择器消歧。 */
  async function searchCities(q: string | undefined): Promise<LocationCandidateDto[]> {
    requireConfigured()
    if (!q?.trim()) return []
    return parseLocations(await getJson('/geo/v2/city/lookup', { location: q.trim(), lang, number: '10' }))
  }

  /** 取一个位置的五合一 bundle。实况失败返回 null(前端该图标重试);空气/预警/预报各自降级。 */
  async function bundleFor(lat: number, lon: number): Promise<WeatherBundleDto | null> {
    requireConfigured()
    const canon = `${fmt(lat)},${fmt(lon)}`
    let now: WeatherNowDto
    try {
      now = await fetchNow(lat, lon, canon)
    } catch (e) {
      console.warn(`天气实况取数失败 ${canon}: ${e}`)
      return null
    }
    let air: WeatherAirDto | null = null
    try {
      air = await fetchAir(lat, lon, canon)
    } catch (e) {
      console.warn(`空气质量取数失败 ${canon}: ${e}`)
    }
    let alerts: WeatherAlertDto[] = []
    try {
      alerts = await fetchAlert(lat, lon, canon)
    } catch (e) {
      console.warn(`天气预警取数失败 ${canon}: ${e}`)
    }
    let hourly: WeatherHourlyDto[] | null = null
    try {
      hourly = await fetchHourly(lat, lon, canon)
    } catch (e) {
      console.warn(`小时预报取数失败 ${canon}: ${e}`)
    }
    let daily: WeatherDailyDto[] | null = null
    try {
      daily = await fetchDaily(lat, lon, canon)
    } catch (e) {
      console.warn(`逐日预报取数失败 ${canon}: ${e}`)
    }
    return {
      location: canon,
      now,
      ...(air ? { air: omitNulls(air) } : {}),
      alerts,
      ...(hourly ? { hourly } : {}),
      ...(daily ? { daily } : {}),
    }
  }

  async function fetchNow(lat: number, lon: number, canon: string): Promise<WeatherNowDto> {
    const cached = nowCache.get(canon)
    if (cached) return cached
    const v = parseNow(
      await getJson('/v7/weather/now', { location: `${fmt(lon)},${fmt(lat)}`, lang, unit: 'm' }), // 经度在前
    )
    nowCache.put(canon, v, NOW_TTL_MS)
    return v
  }

  async function fetchAir(lat: number, lon: number, canon: string): Promise<WeatherAirDto | null> {
    const cached = airCache.get(canon)
    if (cached) return cached
    const v = parseAir(await getJson(`/airquality/v1/current/${fmt(lat)}/${fmt(lon)}`, { lang })) // 纬度在前
    // null(无 AQI 标准)照 Java 也 put,但 get 时 null 视同未命中 → 每次重拉,与 Java 行为一致
    airCache.put(canon, v, AIR_TTL_MS)
    return v
  }

  async function fetchAlert(lat: number, lon: number, canon: string): Promise<WeatherAlertDto[]> {
    const cached = alertCache.get(canon)
    if (cached) return cached
    const v = parseAlerts(await getJson(`/weatheralert/v1/current/${fmt(lat)}/${fmt(lon)}`, { lang })) // 纬度在前
    alertCache.put(canon, v, ALERT_TTL_MS)
    return v
  }

  async function fetchHourly(lat: number, lon: number, canon: string): Promise<WeatherHourlyDto[]> {
    const cached = hourlyCache.get(canon)
    if (cached) return cached
    const v = parseHourly(await getJson('/v7/weather/24h', { location: `${fmt(lon)},${fmt(lat)}`, lang, unit: 'm' })) // 经度在前
    hourlyCache.put(canon, v, HOURLY_TTL_MS)
    return v
  }

  async function fetchDaily(lat: number, lon: number, canon: string): Promise<WeatherDailyDto[]> {
    const cached = dailyCache.get(canon)
    if (cached) return cached
    const v = parseDaily(await getJson('/v7/weather/7d', { location: `${fmt(lon)},${fmt(lat)}`, lang, unit: 'm' })) // 经度在前
    dailyCache.put(canon, v, DAILY_TTL_MS)
    return v
  }

  return { bundleFor, searchCities }
}

/**
 * 两端点(须在 requireAuth 之后挂载):
 * GET /api/weather?location=lat,lon&location=lat,lon → 批量 bundle,键为前端发送的原始串
 *   (发送与回查用同一串确保命中)。重复参数整串为键、逗号不拆(Spring 拆逗号是历史 bug);
 *   非法格式静默跳过;单位置实况失败该键值为 null。
 * GET /api/weather/locations?q=城市名 → GeoAPI 城市候选。
 */
export function weatherRoutes(cfg?: WeatherConfig): Hono {
  const svc = createWeatherService(cfg ?? { apiKey: '', apiHost: '' })
  return new Hono()
    .get('/api/weather', async (c) => {
      const out: Record<string, WeatherBundleDto | null> = {}
      for (const raw of c.req.queries('location') ?? []) {
        const ll = parseLatLon(raw)
        if (!ll) continue // 非法格式跳过(前端控格式,不应出现)
        out[raw] = await svc.bundleFor(ll[0], ll[1])
      }
      return c.json(out)
    })
    .get('/api/weather/locations', async (c) => c.json(await svc.searchCities(c.req.query('q'))))
}
