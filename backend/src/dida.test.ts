import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { didaRoutes, endOfTodayPlus8, parseTodoTasks } from './dida'
import { ConflictError } from './common'

// CONTEXT.md「待办」。纯解析/时区直测 + HTTP 层经真实 stub 上游(127.0.0.1 随机端口)
// 探测缓存/降级/写直通;鉴权横切由契约测试统一覆盖,此处直挂路由(同 aihot.test)。

const TOKEN = 'test-dida-token'
const TASKS = [
  { id: 't2', projectId: 'p1', title: '今日到期', priority: 3, dueDate: '2026-08-24T03:00:00.000+0000' },
  { id: 't1', projectId: 'p1', title: '过期最久', priority: 0, dueDate: '2026-08-20T00:00:00.000+0000' },
  { id: 't3', projectId: 'p2', title: '高优', priority: 5 },
  { id: '', projectId: 'p2', title: '缺 id 跳过', priority: 0 },
  '脏条目',
]

describe('endOfTodayPlus8(UTC+8 时区边界)', () => {
  it('UTC 时间映射 +08 同日 → 当日 23:59:59', () => {
    expect(endOfTodayPlus8(new Date('2026-08-24T10:00:00Z'))).toBe('2026-08-24T23:59:59+08:00')
  })
  it('UTC 16:00 后 +08 已跨日 → 次日 23:59:59(服务器 UTC 时区无关)', () => {
    expect(endOfTodayPlus8(new Date('2026-08-24T17:00:00Z'))).toBe('2026-08-25T23:59:59+08:00')
    expect(endOfTodayPlus8(new Date('2026-12-31T16:00:01Z'))).toBe('2027-01-01T23:59:59+08:00')
  })
})

describe('parseTodoTasks(纯解析)', () => {
  it('裁剪为前端消费字段子集,按到期升序(最紧迫在前),无 due 排尾', () => {
    expect(parseTodoTasks(TASKS)).toEqual([
      { id: 't1', projectId: 'p1', title: '过期最久', priority: 0, dueDate: '2026-08-20T00:00:00.000+0000' },
      { id: 't2', projectId: 'p1', title: '今日到期', priority: 3, dueDate: '2026-08-24T03:00:00.000+0000' },
      { id: 't3', projectId: 'p2', title: '高优', priority: 5, dueDate: null },
    ])
  })
  it('非数组抛;空数组得空列(非失败)', () => {
    expect(() => parseTodoTasks({})).toThrow('缺任务数组')
    expect(parseTodoTasks([])).toEqual([])
  })
})

// ── HTTP 层(stub 上游)─────────────────────────────────────────────────────────

let upstream: Server | null = null
let hits: { method: string; url: string; body: string; auth: string }[] = []
let upstreamStatus = 200

afterEach(async () => {
  if (upstream) await new Promise<void>((r) => upstream!.close(() => r()))
  upstream = null
  hits = []
  upstreamStatus = 200
  vi.useRealTimers()
})

async function startUpstream(): Promise<string> {
  upstream = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      hits.push({
        method: req.method ?? '',
        url: req.url ?? '',
        body: Buffer.concat(chunks).toString(),
        auth: req.headers['authorization'] ?? '',
      })
      res.setHeader('content-type', 'application/json')
      res.statusCode = upstreamStatus
      res.end(JSON.stringify(req.url?.includes('/complete') ? '' : TASKS))
    })
  })
  await new Promise<void>((r) => upstream!.listen(0, '127.0.0.1', r))
  return `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`
}

// 直挂路由 + 复刻 app.onError(错误路径断言须走真实映射;同 weather.test 模式)
const app = (base?: string, token: string = TOKEN) =>
  new Hono()
    .route('/', didaRoutes({ token }, base))
    .onError((err, c) =>
      err instanceof ConflictError
        ? c.json({ status: err.status, message: err.message }, err.status as ContentfulStatusCode)
        : c.json({ status: 500, message: '服务器错误' }, 500),
    )

describe('GET /api/todo(读:口径与降级)', () => {
  it('200 返回裁剪排序列表;上游收到 Bearer 与 search 口径(status=[0]+dueTo)', async () => {
    vi.setSystemTime(new Date('2026-08-24T10:00:00Z'))
    const base = await startUpstream()
    const res = await app(base).request('/api/todo')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(parseTodoTasks(TASKS))
    expect(hits[0]).toMatchObject({
      method: 'POST',
      url: '/open/v1/task/search',
      auth: `Bearer ${TOKEN}`,
    })
    expect(JSON.parse(hits[0].body)).toEqual({ status: [0], dueTo: '2026-08-24T23:59:59+08:00' })
  })

  it('TTL 内命中内存缓存:两次请求只打一次上游', async () => {
    const base = await startUpstream()
    const a = app(base)
    await a.request('/api/todo')
    await a.request('/api/todo')
    expect(hits.length).toBe(1)
  })

  it('上游失败沿用上次成功数据(宁旧勿空);从未成功 → null(HTTP 仍 200)', async () => {
    const base = await startUpstream()
    const a = app(base)
    await a.request('/api/todo')
    upstreamStatus = 500
    const stale = await a.request('/api/todo')
    expect(stale.status).toBe(200)
    expect(await stale.json()).toEqual(parseTodoTasks(TASKS))

    const never = await app(await startUpstream()).request('/api/todo') // 新实例,仍 500
    expect(never.status).toBe(200)
    expect(await never.json()).toBeNull()
  })

  it('未配置口令 → 400 透提示(永久态,不做 lastGood 降级)', async () => {
    const res = await app(undefined, '').request('/api/todo')
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ status: 400, message: expect.stringContaining('DIDA365_TOKEN') })
  })
})

describe('写直通(POST /api/todo、POST /api/todo/complete)', () => {
  it('速记:仅 title 透上游(不指定清单即落收集箱);title 缺 → 400', async () => {
    const base = await startUpstream()
    const a = app(base)
    const res = await a.request('/api/todo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: ' 买牛奶 ' }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(hits[0]).toMatchObject({ method: 'POST', url: '/open/v1/task' })
    expect(JSON.parse(hits[0].body)).toEqual({ title: '买牛奶' })

    const bad = await a.request('/api/todo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(bad.status).toBe(400)
  })

  it('完成:POST /project/{p}/task/{t}/complete;缺参 → 400;写后清读缓存', async () => {
    const base = await startUpstream()
    const a = app(base)
    await a.request('/api/todo') // 预热读缓存
    const res = await a.request('/api/todo/complete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: 'p1', taskId: 't2' }),
    })
    expect(res.status).toBe(200)
    expect(hits.at(-1)).toMatchObject({ method: 'POST', url: '/open/v1/project/p1/task/t2/complete' })

    await a.request('/api/todo') // 写清缓存 → 重打上游
    expect(hits.filter((h) => h.url.includes('/search')).length).toBe(2)

    const bad = await a.request('/api/todo/complete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ taskId: 't2' }),
    })
    expect(bad.status).toBe(400)
  })

  it('写路径上游失败 → 502 透上游状态(不吞不降级)', async () => {
    upstreamStatus = 401
    const base = await startUpstream()
    const res = await app(base).request('/api/todo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'x' }),
    })
    expect(res.status).toBe(502)
    expect(await res.json()).toMatchObject({ status: 502, message: '滴答上游 HTTP 401' })
  })
})
