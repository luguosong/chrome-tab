import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { aihotRoutes, createAihotService, parseDaily, parseHotTopics, parseModelPicks } from './aihot'

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

// items 端点(模型精选)fixture:字段与 hot-topics 不同(无 rank/sourceCount,
// 有 summary/score/reason 等我们不透传的增值字段)。
const PICKS_FIXTURE = {
  schemaVersion: 1,
  items: [
    {
      id: 'cmt2qvfnj03zxro6tehwcikx4',
      title: 'DeepSeek-V4-Flash-Vision-Exp 发布',
      originalTitle: null,
      summary: 'DeepSeek 上线实验性多模态视觉理解模型…',
      source: { name: 'DeepSeek：API 更新日志' },
      links: {
        aihot: 'https://aihot.virxact.com/items/cmt2qvfnj03zxro6tehwcikx4',
        original: 'https://api-docs.deepseek.com/zh-cn/updates',
      },
      publishedAt: '2026-08-21T09:26:04.727Z',
      discoveredAt: '2026-08-21T09:26:04.727Z',
      category: 'ai-models',
      score: 67,
      selected: true,
      reason: '实验版补齐视觉…',
    },
    { title: '缺 id,跳过' },
    { id: 'x2' },
    'not-an-object',
  ],
}

describe('parseModelPicks(纯解析)', () => {
  it('裁剪为前端消费字段子集(summary/score/reason 不透传)', () => {
    expect(parseModelPicks(PICKS_FIXTURE)).toEqual([
      {
        id: 'cmt2qvfnj03zxro6tehwcikx4',
        title: 'DeepSeek-V4-Flash-Vision-Exp 发布',
        sourceName: 'DeepSeek：API 更新日志',
        aihotUrl: 'https://aihot.virxact.com/items/cmt2qvfnj03zxro6tehwcikx4',
        originalUrl: 'https://api-docs.deepseek.com/zh-cn/updates',
        publishedAt: '2026-08-21T09:26:04.727Z',
      },
    ])
  })

  it('缺 items 抛;脏条目(缺 id/title)跳过,不拖垮整表', () => {
    expect(() => parseModelPicks({ items2: [] })).toThrow('缺 items')
    expect(parseModelPicks({ items: [] })).toEqual([])
  })
})

// dailies/latest(AI 日报)fixture:report 包一层;条目无 id(区别于 items 流),
// lead/flashes/generatedAt 等不透传(lead 当天可为 null、flashes 可为空,不稳定)。
const DAILY_FIXTURE = {
  schemaVersion: 1,
  report: {
    date: '2026-08-25',
    generatedAt: '2026-08-25T00:00:00.987Z',
    windowStart: '2026-08-24T16:00:00.000Z',
    windowEnd: '2026-08-25T00:00:00.000Z',
    links: { aihot: 'https://aihot.virxact.com/daily' },
    attribution: { name: 'AIHOT', url: 'https://aihot.virxact.com' },
    lead: null,
    sections: [
      {
        label: '模型发布/更新',
        items: [
          {
            title: 'GPT-5.6 登陆 Kiro,为开发者提升性价比',
            summary: 'GPT-5.6 模型家族现已登陆软件开发智能体 Kiro…',
            source: { name: 'OpenAI：官网动态（RSS）' },
            links: {
              aihot: 'https://aihot.virxact.com/items/cmt7nzq6i2c27ro73tqxagz44',
              original: 'https://openai.com/index/gpt-56-kiro',
            },
            attribution: { name: 'OpenAI' },
          },
          { summary: '缺 title,跳过' },
        ],
      },
      { label: '行业动态', items: [] },
      'not-a-section',
    ],
    flashes: [],
  },
}

describe('parseDaily(纯解析)', () => {
  it('裁剪为前端消费字段子集(generatedAt/lead/flashes 不透传)', () => {
    expect(parseDaily(DAILY_FIXTURE)).toEqual({
      date: '2026-08-25',
      sections: [
        {
          label: '模型发布/更新',
          items: [
            {
              title: 'GPT-5.6 登陆 Kiro,为开发者提升性价比',
              summary: 'GPT-5.6 模型家族现已登陆软件开发智能体 Kiro…',
              sourceName: 'OpenAI：官网动态（RSS）',
              aihotUrl: 'https://aihot.virxact.com/items/cmt7nzq6i2c27ro73tqxagz44',
              originalUrl: 'https://openai.com/index/gpt-56-kiro',
            },
          ],
        },
        { label: '行业动态', items: [] },
      ],
    })
  })

  it('缺 report.sections 抛;空 sections 得空报(非失败,出刊前)', () => {
    expect(() => parseDaily({ items: [] })).toThrow('缺 report.sections')
    expect(parseDaily({ report: { date: '2026-08-25', sections: [] } })).toEqual({
      date: '2026-08-25',
      sections: [],
    })
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
    // 按路径分档:items(模型精选)/ dailies(AI 日报)与 hot-topics 各回各的 fixture
    const body = req.url?.includes('/items')
      ? PICKS_FIXTURE
      : req.url?.includes('/dailies')
        ? DAILY_FIXTURE
        : FIXTURE
    res.end(JSON.stringify(upstreamStatus === 200 ? body : { status: 500, title: 'internal' }))
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

describe('GET /api/aihot/model-picks', () => {
  // TTL/lastGood 与 hot-topics 共用 createCachedSource,由上方用例覆盖;此处验证
  // 路由确实打上游 items 路径(stub 按路径分档,打错路径会解析出空表使断言失败)。
  it('200 返回裁剪后的模型精选', async () => {
    const base = await startUpstream()
    const res = await client(base).request('/api/aihot/model-picks')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(parseModelPicks(PICKS_FIXTURE))
  })
})

describe('GET /api/aihot/daily', () => {
  // 缓存/降级同用 createCachedSource,由 hot-topics 用例覆盖;同样只验证路由打对路径。
  it('200 返回裁剪后的最新一期日报', async () => {
    const base = await startUpstream()
    const res = await client(base).request('/api/aihot/daily')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(parseDaily(DAILY_FIXTURE))
  })
})
