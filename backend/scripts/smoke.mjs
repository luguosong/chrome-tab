#!/usr/bin/env node
/**
 * 票 12 切换冒烟(spec 辅助 seam 2):登录链路 + config/changelog/weather/wallpaper 各一探 + 401 探针。
 * 本地跑,打线上公网:`pnpm smoke [BASE_URL]`(缺省 https://tab.luguosong.cn)。
 * 凭据取 ADMIN_USERNAME/ADMIN_PASSWORD 环境变量;缺省 `ssh tab` 读服务器 .env(只进内存,不打印)。
 */
import { spawnSync } from 'node:child_process'

const base = process.argv[2] ?? process.env.BASE_URL ?? 'https://tab.luguosong.cn'

let { ADMIN_USERNAME: username, ADMIN_PASSWORD: password } = process.env
if (!username || !password) {
  const r = spawnSync(
    'ssh',
    ['tab', 'cd /opt/chrome-tab && grep -E "^(ADMIN_USERNAME|ADMIN_PASSWORD)=" .env'],
    { encoding: 'utf8' },
  )
  if (r.status !== 0) {
    console.error('✗ 无法从服务器读凭据(ssh tab):', r.stderr)
    process.exit(1)
  }
  for (const line of r.stdout.trim().split('\n')) {
    if (line.startsWith('ADMIN_USERNAME=')) username ??= line.slice('ADMIN_USERNAME='.length)
    if (line.startsWith('ADMIN_PASSWORD=')) password ??= line.slice('ADMIN_PASSWORD='.length)
  }
}

let failed = 0
const check = (name, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? `  ${extra}` : ''}`)
  if (!ok) failed++
}

// 1. 静态页(caddy 镜像 = 前端新版)
const home = await fetch(`${base}/`)
check('GET / → 200(静态页,caddy 通)', home.status === 200, home.status)

// 2. 401 探针:未认证 /api/** → 401 空体(反代 + Node 拦截面,契约 §0)
const anon = await fetch(`${base}/api/config`)
const anonBody = await anon.text()
check(
  'GET /api/config 匿名 → 401 空体',
  anon.status === 401 && anonBody === '',
  `${anon.status} body=${JSON.stringify(anonBody)}`,
)

// 3. 登录链路:bcrypt 哈希原样迁移的直接验证(切换日唯一登录一次的载体)
const login = await fetch(`${base}/api/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username, password }),
})
const setCookie = login.headers.get('set-cookie') ?? ''
check('POST /api/login → 200 + JSESSIONID', login.status === 200 && /JSESSIONID=/.test(setCookie), login.status)
check(
  'cookie 属性 Secure; HttpOnly; SameSite=Strict',
  /secure/i.test(setCookie) && /httponly/i.test(setCookie) && /samesite=strict/i.test(setCookie),
)
const cookie = setCookie.split(';')[0]
const authed = (path) => fetch(`${base}${path}`, { headers: { cookie } })

// 4. config:数据对账(HTTP 层)——行数下限只为确认非空(2026-08-24:19→10,线上已删减至 16)
const config = await authed('/api/config')
const cfg = config.status === 200 ? await config.json() : {}
const pages = cfg.pages?.length ?? 0
const icons = cfg.icons?.length ?? 0
check('GET /api/config → 200', config.status === 200, config.status)
check('数据在(pages≥1, icons≥10, updatedAt 非空)', pages >= 1 && icons >= 10 && !!cfg.updatedAt, `pages=${pages} icons=${icons}`)

// 5. changelog:快照表已迁,秒级可服务(ADR-0017 启动恢复)
const changelog = await authed('/api/changelog')
const cl = changelog.status === 200 ? await changelog.json() : {}
check(
  'GET /api/changelog → 200 + markdown',
  changelog.status === 200 && typeof cl.markdown === 'string' && cl.markdown.length > 0,
  changelog.status === 200 ? `translated=${cl.translatedVersions?.length ?? '?'} releasedAt=${cl.releasedAt ?? 'null'}` : changelog.status,
)

// 6. weather:和风代理(ADR-0009),key 已配 → 200;bundle null = 上游降级,不算失败
const wxLoc = '39.9042,116.4074'
const weather = await authed(`/api/weather?location=${wxLoc}`)
const wx = weather.status === 200 ? await weather.json() : {}
check(
  'GET /api/weather → 200',
  weather.status === 200 && wxLoc in wx,
  weather.status === 200 ? `bundle=${wx[wxLoc] ? 'ok' : 'null(上游降级)'}` : weather.status,
)

// 7. wallpaper:必应代理,enddate 天失效缓存(修正白名单③)
const wallpaper = await authed('/api/wallpaper')
check('GET /api/wallpaper → 200', wallpaper.status === 200, wallpaper.status)

console.log(failed === 0 ? `\n冒烟全过 ✓ (${base})` : `\n冒烟失败 ${failed} 项 ✗`)
process.exit(failed === 0 ? 0 : 1)
