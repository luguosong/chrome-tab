// 一次性验证:分组弹层内查看态(非编辑模式)拖拽排序。
// 前提:frontend dev(5173) + 验证后端(8083,/tmp/dnd-verify.db,组31 成员A/B/C/D)。
// 断言:① 查看态成员是 <a> ② 拖 A→D 位发出 move(parentId=31) ③ 拖出弹层无 move + 出现提示。
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const { chromium } = require('/home/luguosong/.npm/_npx/db89d7302a373f10/node_modules/playwright')

const API = 'http://127.0.0.1:8083'
const browser = await chromium.launch()
browser.on('targetcreated', (t) => console.log('  [popup]', t.url()?.slice(0, 60)))
// 视口 1920:默认 1280 下网格右溢出视口,碰撞判定被截断矩形污染(over 乱跳组图标)
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })

// /api 改写到验证后端(vite 代理指向的 8082 另有进程,不能碰)。
// 匹配只认根路径 /api/**:glob '**/api/**' 会误拦 vite 源码模块 /src/api/*.ts(404 白屏)。
// /api/wallpaper 验证后端没有,本地 fulfill 假响应。
await page.route('**/api/wallpaper*', (route) =>
  route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ url: '', copyright: 'verify', date: '2026-08-27' }),
  }),
)
await page.route('**/*', (route) => {
  const u = new URL(route.request().url())
  if (u.origin === 'http://127.0.0.1:5175' && u.pathname.startsWith('/api/')) {
    return route.continue({ url: `${API}${u.pathname}${u.search}` })
  }
  return route.continue()
})
page.setDefaultTimeout(8000)
page.on('framenavigated', (f) => {
  if (f === page.mainFrame()) console.log('  [nav]', f.url().slice(0, 70))
})

const fails = []
const ok = (name, cond) => {
  console.log(`${cond ? '✓' : '✗ FAIL'} ${name}`)
  if (!cond) fails.push(name)
}

// ── 登录(node fetch 拿 cookie 注入 context;浏览器侧登录的 Set-Cookie 会被
//    route 跨域改写挂到 127.0.0.1 域,后续 5175 请求不带 cookie 全 401)─────────
const loginRes = await fetch(`${API}/api/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: 'test1234' }),
})
const [cookie] = loginRes.headers.getSetCookie() ?? []
if (!loginRes.ok || !cookie) throw new Error('登录失败: ' + loginRes.status)
const [name, value] = cookie.split(';')[0].split('=')
await page.context().addCookies([{ name, value, url: 'http://127.0.0.1:5175' }])
await page.goto('http://127.0.0.1:5175/')

// ── 打开分组弹层 ────────────────────────────────────────────────────────
await page.getByText('新建分组', { exact: true }).first().click()
const dialog = page.getByRole('dialog', { name: '分组 新建分组' })
await dialog.waitFor()
const links = dialog.locator('[role="link"]')
await links.first().waitFor()
ok('查看态成员可交互(role=link)', (await links.count()) === 4)

const orderBefore = await dialog.locator('[role="link"] span:last-child').allTextContents()
console.log('  拖前顺序:', orderBefore.join(','))

// ── ① 查看态组内拖拽排序:A 拖到 D 位 ──────────────────────────────────
const a = dialog.locator('[role="link"]', { hasText: 'site-A' })
const d = dialog.locator('[role="link"]', { hasText: 'site-D' })
let moveReq = null
const movePromise = page
  .waitForRequest(
    (r) => r.method() === 'PATCH' && r.url().includes('/api/icons/move'),
    { timeout: 5000 },
  )
  .then((r) => {
    moveReq = { body: JSON.parse(r.postData() ?? '{}') }
  })
  .catch(() => {})

const src = await a.boundingBox()
const dst = await d.boundingBox()
await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2)
await page.mouse.down()
await page.mouse.move(src.x + src.width / 2 + 20, src.y + src.height / 2, { steps: 3 }) // >8px 激活拖拽
await page.mouse.move(dst.x + dst.width / 2, dst.y + dst.height / 2, { steps: 8 })
await page.mouse.up()
await movePromise
ok('拖拽后发出 PATCH /api/icons/move', moveReq != null)
if (moveReq) {
  ok('move 落组内(parentId=31)', moveReq.body.parentId === 31)
  const dIdxBefore = orderBefore.findIndex((t) => t.includes('site-D'))
  ok(
    `move 目标位序合理(toIndex=${moveReq.body.toIndex},拖前 D 位序=${dIdxBefore})`,
    moveReq.body.toIndex === dIdxBefore,
  )
}
await page.waitForTimeout(800) // 等 mutate → invalidate → refetch 重渲染新顺序
const orderAfter = await dialog.locator('[role="link"] span:last-child').allTextContents()
console.log('  拖后顺序:', orderAfter.join(','))
const aIdxAfter = orderAfter.findIndex((t) => t.includes('site-A'))
ok(
  `界面顺序已刷新(A 落 D 原位序 ${orderBefore.findIndex((t) => t.includes('site-D'))})`,
  aIdxAfter === orderBefore.findIndex((t) => t.includes('site-D')),
)

// ── ② 查看态拖出弹层:守卫应拦下(无 move + 提示) ────────────────────────
let moveOutCount = 0
page.on('request', (r) => {
  if (r.method() === 'PATCH' && r.url().includes('/api/icons/move')) moveOutCount++
})
const b = dialog.locator('[role="link"]', { hasText: 'site-B' })
const sb = await b.boundingBox()
// 拖到弹层下方的页面网格(有 droppable,才能真正走到 handleDragOver 的查看态守卫)
await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2)
await page.mouse.down()
await page.mouse.move(sb.x + sb.width / 2 + 20, sb.y + 60, { steps: 3 })
await page.mouse.move(sb.x + sb.width / 2, sb.y + 400, { steps: 6 })
await page.mouse.up()
await page.waitForTimeout(2200) // 越过 notice 1.8s 窗口
ok('拖出弹层未发 move(守卫生效)', moveOutCount === 0)
ok('弹层保持开启', (await dialog.count()) === 1)
const stillGrouped = await dialog.locator('[role="link"] span:last-child').allTextContents()
ok('成员未被移出(B 仍在组内)', stillGrouped.some((t) => t.includes('site-B')))

await page.screenshot({ path: '.scratch/组内查看态拖拽验证/after.png' })
await browser.close()
console.log(fails.length ? `\n${fails.length} 项失败` : '\n全部通过')
process.exit(fails.length ? 1 : 0)
