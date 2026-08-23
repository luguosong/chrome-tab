import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { gzipSync } from 'node:zlib'
import { Hono } from 'hono'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from './app'
import { openDb } from './db'
import { bootstrap } from './seed'
import { baseUrlFor, parseAir, parseAlerts, parseDaily, parseHourly, parseLatLon, parseLocations, parseNow, weatherRoutes } from './weather'

// 契约 §7(ADR-0009)。纯解析直测 + HTTP 层经真实 stub 上游(127.0.0.1 随机端口)探测;
// 401 横切由契约测试统一覆盖,此处直挂路由(不经 createApp,免依赖并行未提交的接线)。

// ── 和风响应形状 fixture ──────────────────────────────────────────────────────

const NOW = {
  obsTime: '2026-08-12T10:00+08:00', temp: '25', feelsLike: '27', icon: '104', text: '阴',
  humidity: '65', windDir: '南风', windScale: '3', windSpeed: '15', pressure: '1010', vis: '10', precip: '0.0',
}
const AIR = {
  indexes: [
    { code: 'us-epa', aqi: 50, category: 'Good', primaryPollutant: { code: 'pm2p5' } },
    { code: 'qaqi', aqi: 42, category: '优', primaryPollutant: { code: 'pm2p5' } },
  ],
  pollutants: [
    { code: 'pm2p5', concentration: { value: 12.3 } },
    { code: 'pm10', concentration: { value: 25 } },
  ],
}
const ALERTS = {
  metadata: { zeroResult: false },
  alerts: [
    {
      id: 'alert1', senderName: '市气象台', severity: 'Moderate',
      eventType: { name: '暴雨' }, headline: '暴雨黄色预警', description: '注意防范',
      effectiveTime: '2026-08-12T10:00+08:00', expireTime: '2026-08-12T20:00+08:00',
      color: { red: 255, green: 200, blue: 0, alpha: 1 },
    },
  ],
}
const GEO = {
  code: '200',
  location: [
    { name: '朝阳', adm1: '北京市', adm2: '朝阳区', lat: '39.92', lon: '116.45' },
    { name: '朝阳', adm1: '辽宁省', adm2: '朝阳市', lat: '41.57', lon: '120.45' },
  ],
}
const HOURLY = {
  code: '200',
  hourly: [
    { fxTime: '2026-08-12T10:00+08:00', temp: '25', icon: '104', text: '阴', pop: '10' },
    { fxTime: '2026-08-12T11:00+08:00', temp: '26', icon: '101', text: '多云', pop: '20' },
  ],
}
const DAILY = {
  code: '200',
  daily: [
    { fxDate: '2026-08-12', tempMax: '31', tempMin: '24', iconDay: '104', textDay: '阴' },
    { fxDate: '2026-08-13', tempMax: '33', tempMin: '25', iconDay: '100', textDay: '晴' },
  ],
}

// ── stub 上游:按路径回放 fixture,可注入失败/覆盖/gzip ─────────────────────────

const hits: Array<{ url: string; key: string | undefined }> = []
const failing = new Set<string>()
const overrides = new Map<string, unknown>()
let gzipAll = false

function respondFor(pathname: string): { status: number; body: unknown } {
  if (failing.has(pathname)) return { status: 500, body: { error: 'boom' } }
  if (overrides.has(pathname)) return { status: 200, body: overrides.get(pathname) }
  if (pathname === '/v7/weather/now') return { status: 200, body: { code: '200', now: NOW } }
  if (pathname === '/v7/weather/24h') return { status: 200, body: HOURLY }
  if (pathname === '/v7/weather/7d') return { status: 200, body: DAILY }
  if (pathname.startsWith('/airquality/v1/current/')) return { status: 200, body: AIR }
  if (pathname.startsWith('/weatheralert/v1/current/')) return { status: 200, body: ALERTS }
  if (pathname === '/geo/v2/city/lookup') return { status: 200, body: GEO }
  return { status: 404, body: {} }
}

const server = createServer((req, res) => {
  hits.push({ url: req.url ?? '/', key: req.headers['x-qw-api-key'] as string | undefined })
  const { status, body } = respondFor(new URL(req.url ?? '/', 'http://x').pathname)
  let buf = Buffer.from(JSON.stringify(body))
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (gzipAll) {
    buf = gzipSync(buf)
    headers['content-encoding'] = 'gzip'
  }
  res.writeHead(status, headers)
  res.end(buf)
})
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
const stubUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

afterAll(() => server.close())
afterEach(() => {
  hits.length = 0
  failing.clear()
  overrides.clear()
  gzipAll = false
  vi.useRealTimers()
})

/** 每用例独立 app → 独立 TTL 缓存(缓存跨用例会互染外呼计数) */
function makeApp() {
  return new Hono()
    .route('/', weatherRoutes({ apiKey: 'test-key', apiHost: stubUrl }))
    .onError((_e, c) => c.json({ status: 500, message: '服务器错误' }, 500))
}

const paths = () => hits.map((h) => new URL(h.url, 'http://x').pathname)
const json = async (res: Response): Promise<Record<string, any>> => (await res.json()) as Record<string, any>

// ── 纯函数(照搬 Java WeatherParserTest / WeatherConfigTest / 逗号守护)──────────

describe('parseLatLon(逗号守护:整串解析不拆)', () => {
  it('合法:两段数字,允许空格与负数', () => {
    expect(parseLatLon('39.90499,116.40529')).toEqual([39.90499, 116.40529])
    expect(parseLatLon(' 39.9 , 116.4 ')).toEqual([39.9, 116.4])
    expect(parseLatLon('-33.87,151.21')).toEqual([-33.87, 151.21])
  })
  it('非法返回 null:段数≠2、空段、非数字', () => {
    for (const bad of ['abc', '1,2,3', '', ',', '39.9,', ',116.4', 'a,b']) {
      expect(parseLatLon(bad)).toBeNull()
    }
  })
})

describe('baseUrlFor(裸主机防御)', () => {
  it('空 → 占位主机(未配置时 requireConfigured 先抛,不会真请求)', () => {
    expect(baseUrlFor('')).toBe('https://devapi.qweatherapi.com')
    expect(baseUrlFor('   ')).toBe('https://devapi.qweatherapi.com')
  })
  it('裸主机一律补 https://;带 scheme 不动', () => {
    expect(baseUrlFor('p75n8gyjky.re.qweatherapi.com')).toBe('https://p75n8gyjky.re.qweatherapi.com')
    expect(baseUrlFor('https://abc.qweatherapi.com')).toBe('https://abc.qweatherapi.com')
    expect(baseUrlFor('http://localhost:8080')).toBe('http://localhost:8080')
  })
})

describe('parseNow', () => {
  it('v7 字符串字段归一化(整数/浮点/字符串)', () => {
    expect(parseNow({ code: '200', now: NOW })).toEqual({
      obsTime: '2026-08-12T10:00+08:00', temp: 25, feelsLike: 27, icon: '104', text: '阴',
      humidity: 65, windDir: '南风', windScale: '3', windSpeed: '15', pressure: 1010, vis: 10, precip: 0,
    })
  })
  it('code 非 200 / 缺 now → 抛(调用方据此整 bundle null)', () => {
    expect(() => parseNow({ code: '404' })).toThrow()
    expect(() => parseNow({ code: '200' })).toThrow()
  })
})

describe('parseAir', () => {
  it('优先 qaqi(非首个 us-epa)、污染物按 code 取浓度、缺失项 null', () => {
    const air = parseAir(AIR)!
    expect(air.aqi).toBe(42)
    expect(air.category).toBe('优')
    expect(air.primary).toBe('pm2p5')
    expect(air.pm2p5).toBe(12.3)
    expect(air.pm10).toBe(25)
    expect(air.so2).toBeNull()
  })
  it('无 qaqi 回退首个 index;indexes 空 → null', () => {
    const air = parseAir({ indexes: [{ code: 'us-epa', aqi: 88, category: 'Moderate' }], pollutants: [] })!
    expect(air.aqi).toBe(88)
    expect(air.category).toBe('Moderate')
    expect(parseAir({ indexes: [], pollutants: [] })).toBeNull()
  })
})

describe('parseAlerts', () => {
  it('逐条映射 v1 形态(eventType.name 拍平、color 取 rgb)', () => {
    const alerts = parseAlerts(ALERTS)
    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toMatchObject({
      headline: '暴雨黄色预警', eventType: '暴雨', severity: 'Moderate',
      color: { red: 255, green: 200, blue: 0 },
    })
  })
  it('metadata.zeroResult → 空列表(无预警,非失败)', () => {
    expect(parseAlerts({ metadata: { zeroResult: true }, alerts: [] })).toEqual([])
  })
})

describe('parseLocations', () => {
  it('候选含坐标(同名城市靠 adm1 消歧)', () => {
    expect(parseLocations(GEO)).toEqual([
      { name: '朝阳', adm1: '北京市', adm2: '朝阳区', lat: 39.92, lon: 116.45 },
      { name: '朝阳', adm1: '辽宁省', adm2: '朝阳市', lat: 41.57, lon: 120.45 },
    ])
  })
  it('code 非 200 → 空列表', () => {
    expect(parseLocations({ code: '404' })).toEqual([])
  })
})

describe('parseHourly / parseDaily(预报:v7 字符串字段归一化)', () => {
  it('hourly:fxTime/temp/icon/text 映射,丢弃多余字段', () => {
    expect(parseHourly(HOURLY)).toEqual([
      { fxTime: '2026-08-12T10:00+08:00', temp: 25, icon: '104', text: '阴' },
      { fxTime: '2026-08-12T11:00+08:00', temp: 26, icon: '101', text: '多云' },
    ])
  })
  it('daily:fxDate/温度区间/iconDay/textDay 映射', () => {
    expect(parseDaily(DAILY)).toEqual([
      { fxDate: '2026-08-12', tempMax: 31, tempMin: 24, iconDay: '104', textDay: '阴' },
      { fxDate: '2026-08-13', tempMax: 33, tempMin: 25, iconDay: '100', textDay: '晴' },
    ])
  })
  it('code 非 200 / 缺数组 → 抛(调用方据此省略预报段)', () => {
    expect(() => parseHourly({ code: '404' })).toThrow()
    expect(() => parseHourly({ code: '200' })).toThrow()
    expect(() => parseDaily({ code: '404' })).toThrow()
    expect(() => parseDaily({ code: '200' })).toThrow()
  })
})

// ── HTTP 层(批量端点)───────────────────────────────────────────────────────

describe('GET /api/weather(批量,重复 location 整串为键)', () => {
  it('200:原始串为响应键、bundle.location 为规范化键(两表示并存);经纬度入参顺序与 Key 头', async () => {
    const res = await makeApp().request('/api/weather?location=39.90499,116.40529')
    expect(res.status).toBe(200)
    const out = await json(res)
    expect(Object.keys(out)).toEqual(['39.90499,116.40529'])
    const b = out['39.90499,116.40529']!
    expect(b.location).toBe('39.90,116.41')
    expect(b.now.temp).toBe(25)
    expect(b.now.text).toBe('阴')
    expect(b.air.aqi).toBe(42)
    expect(b.air).not.toHaveProperty('so2') // NON_NULL:缺失污染物省略,不得置 null
    expect(b.alerts).toHaveLength(1)
    expect(b.hourly).toHaveLength(2)
    expect(b.daily).toHaveLength(2)
    // now/24h/7d 的 location=lon,lat(经度在前);v1 路径 /{lat}/{lon}(纬度在前)
    expect(paths()).toEqual([
      '/v7/weather/now',
      '/airquality/v1/current/39.90/116.41',
      '/weatheralert/v1/current/39.90/116.41',
      '/v7/weather/24h',
      '/v7/weather/7d',
    ])
    expect(new URL(hits[0]!.url, 'http://x').searchParams.get('location')).toBe('116.41,39.90')
    expect(hits[0]!.key).toBe('test-key')
  })

  it('重复参数各存:两个原始串两键', async () => {
    const res = await makeApp().request('/api/weather?location=39.9,116.4&location=31.2,121.5')
    const out = await json(res)
    expect(Object.keys(out)).toEqual(['39.9,116.4', '31.2,121.5'])
    expect(out['31.2,121.5']!.location).toBe('31.20,121.50')
    expect(paths()).toHaveLength(10)
  })

  it('无 location → {}', async () => {
    const res = await makeApp().request('/api/weather')
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({})
  })

  it('非法项静默跳过,合法项不受影响', async () => {
    const res = await makeApp().request('/api/weather?location=abc&location=39.9,116.4&location=1,2,3&location=,')
    const out = await json(res)
    expect(Object.keys(out)).toEqual(['39.9,116.4'])
    expect(paths()).toHaveLength(5)
  })

  it('同坐标不同原始串共享缓存(规范化键为桶):三端点仅各拉一次', async () => {
    const res = await makeApp().request('/api/weather?location=39.904,116.407&location=39.90,116.41')
    const out = await json(res)
    expect(Object.keys(out)).toEqual(['39.904,116.407', '39.90,116.41'])
    expect(out['39.904,116.407']!.location).toBe('39.90,116.41')
    expect(paths()).toHaveLength(5)
  })

  it('实况失败 → 该键 null,且不再拉空气/预警(整 bundle null)', async () => {
    failing.add('/v7/weather/now')
    const res = await makeApp().request('/api/weather?location=39.9,116.4')
    await expect(res.json()).resolves.toEqual({ '39.9,116.4': null })
    expect(paths()).toEqual(['/v7/weather/now'])
  })

  it('空气失败仅空气降级:air 字段省略,实况/预警不受影响', async () => {
    failing.add('/airquality/v1/current/39.90/116.40')
    const res = await makeApp().request('/api/weather?location=39.9,116.4')
    const out = await json(res)
    const b = out['39.9,116.4']!
    expect(b.now.temp).toBe(25)
    expect('air' in b).toBe(false)
    expect(b.alerts).toHaveLength(1)
    expect(paths()).toHaveLength(5)
  })

  it('预警失败仅预警降级:alerts 空数组,实况/空气不受影响', async () => {
    failing.add('/weatheralert/v1/current/39.90/116.40')
    const res = await makeApp().request('/api/weather?location=39.9,116.4')
    const out = await json(res)
    const b = out['39.9,116.4']!
    expect(b.now.temp).toBe(25)
    expect(b.air.aqi).toBe(42)
    expect(b.alerts).toEqual([])
    expect(paths()).toHaveLength(5)
  })

  it('24h 失败仅小时预报降级:hourly 省略,其余不受影响(7d 同理各自独立)', async () => {
    failing.add('/v7/weather/24h')
    failing.add('/v7/weather/7d')
    const res = await makeApp().request('/api/weather?location=39.9,116.4')
    const out = await json(res)
    const b = out['39.9,116.4']!
    expect(b.now.temp).toBe(25)
    expect('hourly' in b).toBe(false)
    expect('daily' in b).toBe(false)
    expect(paths()).toHaveLength(5)
  })

  it('TTL 缓存:失败不缓存(恢复后重拉)、成功缓存(命中零外呼)', async () => {
    const app = makeApp()
    failing.add('/v7/weather/now')
    await expect((await app.request('/api/weather?location=39.9,116.4')).json()).resolves.toEqual({ '39.9,116.4': null })
    expect(paths()).toEqual(['/v7/weather/now'])
    // 失败未被缓存 → 同参重试再打上游
    await expect((await app.request('/api/weather?location=39.9,116.4')).json()).resolves.toEqual({ '39.9,116.4': null })
    expect(paths()).toEqual(['/v7/weather/now', '/v7/weather/now'])
    failing.clear()
    const ok = await json(await app.request('/api/weather?location=39.9,116.4'))
    expect(ok['39.9,116.4']!.now.temp).toBe(25)
    // 累计外呼:2 次失败 now + 1 次成功 now + air + alert + 24h + 7d = 7
    expect(paths()).toHaveLength(7)
    // 成功已缓存 → 同参零外呼(计数不动)
    await app.request('/api/weather?location=39.9,116.4')
    expect(paths()).toHaveLength(7)
  })

  it('TTL 分桶过期:实况 10min/预警 5min 到期重拉,空气/预报 30min 未到零外呼', async () => {
    const app = makeApp()
    await app.request('/api/weather?location=39.9,116.4')
    expect(paths()).toHaveLength(5)
    vi.setSystemTime(Date.now() + 11 * 60_000)
    await app.request('/api/weather?location=39.9,116.4')
    expect(paths()).toHaveLength(7)
  })

  it('和风无条件 gzip:上游 gzip 响应照常解析(Node fetch 自动解压并摘头,Java 拦截器语义)', async () => {
    gzipAll = true
    const res = await makeApp().request('/api/weather?location=39.9,116.4')
    expect(res.status).toBe(200)
    expect((await json(res))['39.9,116.4']!.now.temp).toBe(25)
  })

  it('Key 未配置 → 500 {status:500, message:"服务器错误"}(两端点)', async () => {
    const app = new Hono().route('/', weatherRoutes()).onError((_e, c) => c.json({ status: 500, message: '服务器错误' }, 500))
    for (const path of ['/api/weather?location=39.9,116.4', '/api/weather/locations?q=x']) {
      const res = await app.request(path)
      expect(res.status).toBe(500)
      await expect(res.json()).resolves.toEqual({ status: 500, message: '服务器错误' })
    }
  })
})

// ── HTTP 层(城市搜索)───────────────────────────────────────────────────────

describe('GET /api/weather/locations', () => {
  it('代理 GeoAPI:location/lang/number 透传,候选坐标消歧', async () => {
    const res = await makeApp().request(`/api/weather/locations?q=${encodeURIComponent('朝阳')}`)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual(GEO.location.map((l) => ({
      name: l.name, adm1: l.adm1, adm2: l.adm2, lat: Number(l.lat), lon: Number(l.lon),
    })))
    const u = new URL(hits[0]!.url, 'http://x')
    expect(u.pathname).toBe('/geo/v2/city/lookup')
    expect(u.searchParams.get('location')).toBe('朝阳')
    expect(u.searchParams.get('lang')).toBe('zh-hans')
    expect(u.searchParams.get('number')).toBe('10')
  })

  it('空白/缺失 q → [](零外呼;Java 缺参 400,前端恒带 q,空串语义一致)', async () => {
    const app = makeApp()
    for (const p of ['/api/weather/locations?q=', '/api/weather/locations?q=%20%20', '/api/weather/locations']) {
      const res = await app.request(p)
      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toEqual([])
    }
    expect(hits).toHaveLength(0)
  })

  it('上游 code 非 200 → [](经解析器,非 500)', async () => {
    overrides.set('/geo/v2/city/lookup', { code: '404' })
    const res = await makeApp().request('/api/weather/locations?q=x')
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual([])
  })
})

// ── createApp 接线冒烟(配置注入 + 鉴权拦截面)────────────────────────────────

const wiringDb = openDb(':memory:').db
await bootstrap(wiringDb, { username: 'admin', password: 'admin-pw' })

describe('createApp 接线', () => {
  async function loginCookie(app: ReturnType<typeof createApp>): Promise<string> {
    const res = await app.request('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin-pw' }),
    })
    return res.headers.getSetCookie()[0]!.split(';')[0]!
  }

  it('weather 配置注入生效:登录后批量端点可达', async () => {
    const app = createApp({ db: wiringDb, weather: { apiKey: 'test-key', apiHost: stubUrl } })
    const res = await app.request('/api/weather?location=39.9,116.4', { headers: { cookie: await loginCookie(app) } })
    expect(res.status).toBe(200)
    expect((await json(res))['39.9,116.4']!.now.temp).toBe(25)
  })

  it('未认证 401 空体(weather / locations / wallpaper 横切抽检)', async () => {
    const app = createApp({ db: wiringDb })
    for (const p of ['/api/weather?location=39.9,116.4', '/api/weather/locations?q=x', '/api/wallpaper']) {
      const res = await app.request(p)
      expect(res.status).toBe(401)
      expect(await res.text()).toBe('')
    }
  })
})
