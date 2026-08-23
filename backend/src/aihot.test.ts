import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { aihotRoutes, createAihotService, parseHotTopics } from './aihot'

// CONTEXT.md「AI 热点」。纯解析直测 + HTTP 层经真实 stub 上游(127.0.0.1 随机端口)
// 探测缓存/降级;鉴权横切由契约测试统一覆盖,此处直挂路由(同 weather.test)。

const FIXTURE = {
  schemaVersion: 1,
  count: 2,
  items: [
    {
      rank: 1,
      id: 'cmt3wt4qm13utro6t0hb6ga3y',
      title: '蚂蚁百灵为SGLang推出权重缓存守护进程',
      source: { name: 'X：蚂蚁百灵 (@AntLingAGI)' },
      links: {
        aihot: 'https://aihot.virxact.com/items/cmt3wt4qm13utro6t0hb6ga3y',
        original: 'https://x.com/AntLingAGI/status/2091021795373855124',
        story: 'https://aihot.virxact.com/story/d45274fb',
      },
      sourceCount: 2,
      signalCount: 0,
      latestAt: '2026-08-22T05:00:00.912Z',
    },
    { rank: 'x', title: 'rank 非数字,跳过' },
    { rank: 3 },
  ],
}

describe('parseHotTopics(纯解析)', () => {
  it('裁剪为前端消费字段子集', () => {
    expect(parseHotTopics(FIXTURE)).toEqual([
      {
        rank: 1,
        title: '蚂蚁百灵为SGLang推出权重缓存守护进程',
        sourceName: 'X：蚂蚁百灵 (@AntLingAGI)',
        storyUrl: 'https://aihot.virxact.com/story/d45274fb',
        originalUrl: 'https://x.com/AntLingAGI/status/2091021795373855124',
        sourceCount: 2,
        latestAt: '2026-08-22T05:00:00.912Z',
      },
    ])
  })

  it('缺 items 抛;空 items 得空榜(非失败)', () => {
    expect(() => parseHotTopics({ count: 0 })).toThrow('缺 items')
    expect(parseHotTopics({ items: [] })).toEqual([])
  })

  it('脏条目(缺 rank/title)跳过,不拖垮整榜', () => {
    expect(parseHotTopics({ items: [{ rank: 1 }, { title: '无 rank' }, null, { rank: 2, title: 'ok' }] })).toEqual([
      expect.objectContaining({ rank: 2, title: 'ok' }),
    ])
  })
})

// ── HTTP 层(stub 上游)─────────────────────────────────────────────────────────

let upstream: Server | null = null
let hits = 0
let upstreamStatus = 200
let seenUa = ''

afterEach(async () => {
  if (upstream) await new Promise<void>((r) => upstream!.close(() => r()))
  upstream = null
  hits = 0
  upstreamStatus = 200
  vi.useRealTimers()
})

async function startUpstream(): Promise<string> {
  upstream = createServer((req, res) => {
    hits++
    seenUa = req.headers['user-agent'] ?? ''
    res.setHeader('content-type', 'application/json')
    res.statusCode = upstreamStatus
    res.end(JSON.stringify(upstreamStatus === 200 ? FIXTURE : { status: 500, title: 'internal' }))
  })
  await new Promise<void>((r) => upstream!.listen(0, '127.0.0.1', r))
  return `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`
}

function client(base: string) {
  return aihotRoutes(base)
}

describe('GET /api/aihot/hot-topics(缓存与降级)', () => {
  it('200 返回裁剪后的榜单,并按约定携带匿名 actor UA', async () => {
    const base = await startUpstream()
    const res = await client(base).request('/api/aihot/hot-topics')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(parseHotTopics(FIXTURE))
    expect(seenUa).toMatch(/^aihot-api\/1\.0 aihot-actor\/[0-9a-f-]{36}$/)
  })

  it('TTL 内命中内存缓存:两次请求只打一次上游', async () => {
    const base = await startUpstream()
    const app = client(base)
    await app.request('/api/aihot/hot-topics')
    await app.request('/api/aihot/hot-topics')
    expect(hits).toBe(1)
  })

  it('TTL 过期后重新打上游', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-23T12:00:00Z'))
    const base = await startUpstream()
    const app = client(base)
    await app.request('/api/aihot/hot-topics')
    vi.setSystemTime(new Date('2026-08-23T12:05:01Z')) // 300s + 1s
    await app.request('/api/aihot/hot-topics')
    expect(hits).toBe(2)
  })

  it('上游失败沿用上次成功数据(宁旧勿空)', async () => {
    const base = await startUpstream()
    const app = client(base)
    await app.request('/api/aihot/hot-topics')
    upstreamStatus = 500
    const res = await app.request('/api/aihot/hot-topics')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(parseHotTopics(FIXTURE))
  })

  it('从未成功 → null(HTTP 仍 200,前端据此显示重试)', async () => {
    upstreamStatus = 500
    const base = await startUpstream()
    const res = await client(base).request('/api/aihot/hot-topics')
    expect(res.status).toBe(200)
    expect(await res.json()).toBeNull()
  })

  it('服务实例互相独立(各自缓存,互不串档)', async () => {
    const base = await startUpstream()
    await createAihotService(base).hotTopics()
    await createAihotService(base).hotTopics()
    expect(hits).toBe(2)
  })
})
