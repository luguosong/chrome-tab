import { Hono } from 'hono'
import { beforeEach, describe, expect, it } from 'vitest'
import { createWallpaperHandler } from './wallpaper'

// 契约 §8 + 修正白名单③:缓存按天(enddate)失效——变化才重拉、失败沿用旧值。
// fetch 与时钟注入(不打真网);401 横切由契约测试统一覆盖,此处直挂路由(不经 createApp)。

const BING_URL = 'https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=zh-CN'
// 12:00 北京时间;跨日测试 +24h 保持同时刻,只动日界
const T0 = Date.parse('2026-08-22T04:00:00Z')
let clock = T0

function bing(enddate: string, tag: string): Response {
  return new Response(
    JSON.stringify({ images: [{ urlbase: `/th?id=OHR.${tag}`, copyright: `${tag} (${enddate})`, enddate }] }),
    { headers: { 'content-type': 'application/json' } },
  )
}

const guilin = {
  url: 'https://www.bing.com/th?id=OHR.Guilin_1920x1080.jpg',
  copyright: 'Guilin (20260822)',
  date: '20260822',
}

/** fetch 桩:按队列出 Response(耗尽 = 上游 503 失败),记录调用 URL */
function makeApp() {
  const calls: string[] = []
  const queue: Array<() => Response> = []
  const fetchFn: typeof fetch = async (input) => {
    calls.push(String(input))
    return queue.shift()?.() ?? new Response('boom', { status: 503 })
  }
  const app = new Hono()
    .get('/api/wallpaper', createWallpaperHandler({ fetchFn, now: () => clock }))
    // 镜像 app.ts 兜底形状(接线统一落在 createApp)
    .onError((_err, c) => c.json({ status: 500, message: '服务器错误' }, 500))
  const get = () => app.request('/api/wallpaper')
  return { calls, queue, get }
}

beforeEach(() => {
  clock = T0
})

describe('GET /api/wallpaper(修正③:按天失效)', () => {
  it('200:拼完整图 URL + copyright/date,fetch 打必应归一化参数', async () => {
    const { calls, queue, get } = makeApp()
    queue.push(() => bing('20260822', 'Guilin'))
    const res = await get()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual(guilin)
    expect(calls).toEqual([BING_URL])
  })

  it('同日第二请求命中缓存:零外呼、同值', async () => {
    const { calls, queue, get } = makeApp()
    queue.push(() => bing('20260822', 'Guilin'))
    await get()
    const second = await get()
    expect(second.status).toBe(200)
    await expect(second.json()).resolves.toEqual(guilin)
    expect(calls).toHaveLength(1)
  })

  it('跨北京日界才重拉并换新值', async () => {
    const { calls, queue, get } = makeApp()
    queue.push(() => bing('20260822', 'Guilin'))
    await get()
    clock += 24 * 3600 * 1000
    queue.push(() => bing('20260823', 'Yangtze'))
    const res = await get()
    await expect(res.json()).resolves.toEqual({
      url: 'https://www.bing.com/th?id=OHR.Yangtze_1920x1080.jpg',
      copyright: 'Yangtze (20260823)',
      date: '20260823',
    })
    expect(calls).toHaveLength(2)
  })

  it('换新失败沿用旧值(修正③ negative):503 → 仍 200 旧图;恢复后(同日)即换新', async () => {
    const { calls, queue, get } = makeApp()
    queue.push(() => bing('20260822', 'Guilin'))
    await get()
    clock += 24 * 3600 * 1000
    // 上游失败(队列空 → 503):旧值顶上,缓存不清
    const stale = await get()
    expect(stale.status).toBe(200)
    await expect(stale.json()).resolves.toMatchObject({ date: '20260822' })
    // 恢复:同一日内重试成功即换新
    queue.push(() => bing('20260823', 'Yangtze'))
    const fresh = await get()
    await expect(fresh.json()).resolves.toMatchObject({ date: '20260823' })
    expect(calls).toHaveLength(3)
  })

  it('无缓存且失败 → 500 {status:500, message:"服务器错误"}', async () => {
    const { get } = makeApp() // 队列空 → 503
    const res = await get()
    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toEqual({ status: 500, message: '服务器错误' })
  })

  it('响应不含 images → 500(契约:不含 images 抛)', async () => {
    const { queue, get } = makeApp()
    queue.push(() => new Response(JSON.stringify({ foo: 1 }), { headers: { 'content-type': 'application/json' } }))
    const res = await get()
    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toEqual({ status: 500, message: '服务器错误' })
  })
})
