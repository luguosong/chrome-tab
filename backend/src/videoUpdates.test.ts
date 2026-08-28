import { createHash } from 'node:crypto'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import {
  buildWbiQuery,
  extractCanonical,
  extractOg,
  mixinKey,
  parseBloggerUrl,
  parseDurationSeconds,
  parseYouTubeRss,
} from './videoUpdates'

// ── 纯函数段(模块级 seam:无 IO)──────────────────────────────────────────

describe('parseDurationSeconds(ISO 8601 / 冒号两形态 → 秒)', () => {
  it.each([
    ['PT15M33S', 933],
    ['PT1H2M3S', 3723],
    ['P1DT2H', 93_600],
    ['PT30S', 30],
    ['24:39', 1479],
    ['1:02:39', 3759],
    ['0:30', 30],
  ])('%s → %i', (input, want) => {
    expect(parseDurationSeconds(input)).toBe(want)
  })

  it.each([['PT'], ['abc'], [''], ['12'], ['::']])('%s → null', (input) => {
    expect(parseDurationSeconds(input)).toBeNull()
  })
})

describe('parseBloggerUrl(主页 URL → 平台博主标识)', () => {
  it('YouTube 四形态', () => {
    expect(parseBloggerUrl('https://www.youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw')).toEqual({
      platform: 'youtube',
      kind: 'channel',
      value: 'UC_x5XG1OV2P6uZZ5FSM9Ttw',
    })
    expect(parseBloggerUrl('https://youtube.com/@somehandle')).toEqual({
      platform: 'youtube',
      kind: 'handle',
      value: 'somehandle',
    })
    expect(parseBloggerUrl('https://www.youtube.com/c/CustomName')).toEqual({
      platform: 'youtube',
      kind: 'custom',
      value: 'CustomName',
    })
    expect(parseBloggerUrl('https://www.youtube.com/user/legacyname')).toEqual({
      platform: 'youtube',
      kind: 'user',
      value: 'legacyname',
    })
  })

  it('B站空间页(含 /video、/upload 后缀变体)', () => {
    const want = { platform: 'bilibili', kind: 'space' as const, value: '2267573' }
    expect(parseBloggerUrl('https://space.bilibili.com/2267573')).toEqual(want)
    expect(parseBloggerUrl('https://space.bilibili.com/2267573/video')).toEqual(want)
    expect(parseBloggerUrl('https://space.bilibili.com/2267573/upload')).toEqual(want)
  })

  it.each([
    ['https://www.youtube.com/watch?v=abc'],
    ['https://www.bilibili.com/video/BV1xx'],
    ['https://example.com'],
    ['随便一段文字'],
    [''],
  ])('非主页形态 %s → null', (url) => {
    expect(parseBloggerUrl(url)).toBeNull()
  })
})

describe('mixinKey(wbi 重排截 32)', () => {
  // 64 位唯一字符:任一索引错位即显形。前 8 位与末 4 位由 MIXIN_KEY_ENC_TAB 手工核对。
  const RAW = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ@#'
  const key = mixinKey(RAW.slice(0, 32), RAW.slice(32))
  it('长度 32,且是 raw 的子序列(字符全部来自 raw)', () => {
    expect(key).toHaveLength(32)
    expect(RAW).toContain(key[0])
    for (const ch of key) expect(RAW).toContain(ch)
  })
  it('前 8 位 = 表[46,47,18,2,53,8,23,32](手工核对)', () => {
    expect(key.slice(0, 8)).toBe('KLi2R8nw')
  })
  it('末 4 位 = 截断表[28..31]=[12,38,41,13](手工核对)', () => {
    expect(key.slice(-4)).toBe('cCFd')
  })
})

describe('buildWbiQuery(键升序 + value 过滤 + w_rid)', () => {
  const MK = 'ea1db124af3c7062474693fa704b4d23'
  it('参数含 wts 按键名升序拼接,值 encodeURIComponent', () => {
    const { query } = buildWbiQuery({ mid: '42', keyword: 'a b' }, MK, 1_700_000_000)
    expect(query).toBe('keyword=a%20b&mid=42&wts=1700000000')
  })
  it("value 过滤 !'()* 字符(wbi 签名口径)", () => {
    const { query } = buildWbiQuery({ foo: "a!'()*b" }, MK, 5)
    expect(query).toBe('foo=ab&wts=5')
  })
  it('wRid = md5(query + mixinKey)(拼接正确性;md5 本身是标准库)', () => {
    const { query, wRid } = buildWbiQuery({ mid: '1' }, MK, 9)
    expect(wRid).toBe(createHash('md5').update(query + MK, 'utf8').digest('hex'))
  })
})

describe('parseYouTubeRss(官方 RSS XML → 条目)', () => {
  const XML = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
 <link rel="alternate" href="https://www.youtube.com/"/>
 <entry>
  <id>yt:video:abc123</id>
  <yt:videoId>abc123</yt:videoId>
  <yt:channelId>UC_x5XG1OV2P6uZZ5FSM9Ttw</yt:channelId>
  <title>标题 &amp; 符号</title>
  <link rel="alternate" href="https://www.youtube.com/watch?v=abc123"/>
  <author>
   <name>Google for Developers</name>
   <uri>https://www.youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw</uri>
  </author>
  <published>2026-08-25T01:02:03+00:00</published>
  <updated>2026-08-25T01:03:04+00:00</updated>
  <media:group>
   <media:title>标题 &amp; 符号</media:title>
   <media:content url="https://www.youtube.com/v/abc123" type="application/x-shockwave-flash" width="640" height="360"/>
   <media:thumbnail url="https://i1.ytimg.com/vi/abc123/hqdefault.jpg" width="480" height="360"/>
  </media:group>
 </entry>
 <entry>
  <yt:videoId>short01</yt:videoId>
  <title>一条 shorts</title>
  <link rel="alternate" href="https://www.youtube.com/shorts/short01"/>
  <author><name>Google for Developers</name></author>
  <published>2026-08-24T10:00:00Z</published>
  <media:group>
   <media:thumbnail url="https://i1.ytimg.com/vi/short01/hqdefault.jpg" width="480" height="360"/>
  </media:group>
 </entry>
</feed>`

  it('逐条解析:videoId/标题(实体解码)/URL(shorts 原样)/unix 秒缩略图/频道名', () => {
    const items = parseYouTubeRss(XML)
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      videoId: 'abc123',
      title: '标题 & 符号',
      url: 'https://www.youtube.com/watch?v=abc123',
      thumbnailUrl: 'https://i1.ytimg.com/vi/abc123/hqdefault.jpg',
      authorName: 'Google for Developers',
    })
    expect(items[0]!.publishedAt).toBe(Date.parse('2026-08-25T01:02:03+00:00') / 1000)
    expect(items[1]!.url).toBe('https://www.youtube.com/shorts/short01')
  })

  it('空 feed / 非 XML → 空数组(不抛)', () => {
    expect(parseYouTubeRss('<feed xmlns="http://www.w3.org/2005/Atom"></feed>')).toEqual([])
    expect(parseYouTubeRss('not xml at all')).toEqual([])
  })
})

describe('extractCanonical / extractOg(频道页一次性解析)', () => {
  const HTML = `<html><head>
    <link rel="canonical" href="https://www.youtube.com/channel/UCxxx999">
    <meta property="og:title" content="频道昵称">
    <meta property="og:image" content="https://yt3.googleusercontent.com/abc=s900-c">
  </head><body>…</body></html>`
  it('canonical → channel URL;og → 标题与头像', () => {
    expect(extractCanonical(HTML)).toBe('https://www.youtube.com/channel/UCxxx999')
    expect(extractOg(HTML)).toEqual({
      title: '频道昵称',
      image: 'https://yt3.googleusercontent.com/abc=s900-c',
    })
  })
  it('缺 meta → null 字段(不抛)', () => {
    expect(extractCanonical('<html><head></head></html>')).toBeNull()
    expect(extractOg('<html><head></head></html>')).toEqual({ title: null, image: null })
  })
})

// ── 服务级与 HTTP 契约段(mock fetch URL 路由,零真网——B站真网连发即风控,测试红线)──

import { createApp } from './app'
import { openDb } from './db'
import { bootstrap } from './seed'
import { VideoUpdatesService, type VideoDeps } from './videoUpdates'
import { STUB_UPSTREAM_KEY } from './testUtils'

const MIXIN = '0123456789abcdef0123456789abcdef'

/** YouTube RSS XML 生成(条目形态照研究实抓样本)。 */
function ytRss(entries: Array<{ id: string; title: string; iso: string; author: string }>) {
  const body = entries
    .map(
      (e) => `<entry><yt:videoId>${e.id}</yt:videoId><title>${e.title}</title>
  <link rel="alternate" href="https://www.youtube.com/watch?v=${e.id}"/>
  <author><name>${e.author}</name></author><published>${e.iso}</published>
  <media:group><media:thumbnail url="https://i1.ytimg.com/vi/${e.id}/hqdefault.jpg" width="480" height="360"/></media:group></entry>`,
    )
    .join('')
  return `<?xml version="1.0"?><feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">${body}</feed>`
}

/** B站 arc/search vlist 生成:created 递减(第 k 新的发得晚)、length 两种形态轮换、pic 故意 http。 */
function vlist(from: number, n: number) {
  return Array.from({ length: n }, (_, i) => {
    const k = from + i
    return {
      bvid: `BV${k}`,
      title: `视频${k}`,
      pic: `http://i2.hdslb.com/bfs/archive/${k}.jpg`,
      length: k % 2 ? '24:39' : '1:02:39',
      created: 1_700_000_000 - k * 3_600,
      author: '某UP',
    }
  })
}

type World = Awaited<ReturnType<typeof makeWorld>>

/** 每测试一套:内存库 + mock-deps 服务 + 真 app(HTTP 契约照 changelog.test 范式)。 */
async function makeWorld(
  opts: {
    routes?: Record<string, (url: string) => string>
    youtubeApiKey?: string
    bilibiliCookie?: string
  } = {},
) {
  const { db } = openDb(':memory:')
  await bootstrap(db, { username: 'admin', password: 'pw' })
  const sleepCalls: number[] = []
  const deps: VideoDeps = {
    fetchText: async (url) => {
      for (const [frag, fn] of Object.entries(opts.routes ?? {})) {
        if (url.includes(frag)) return fn(url)
      }
      throw new Error(`mock 无路由: ${url}`)
    },
    getMixinKey: async () => MIXIN,
    sleep: (ms) => {
      sleepCalls.push(ms)
      return Promise.resolve()
    },
    youtubeApiKey: opts.youtubeApiKey ?? '',
    bilibiliCookie: opts.bilibiliCookie ?? '',
  }
  const service = new VideoUpdatesService(db, deps)
  const app = createApp({ db, videoUpdates: service })
  const loginRes = await app.request('/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'pw' }),
  })
  const login = loginRes.headers.getSetCookie()[0]!.split(';')[0]!
  const req = (method: string, path: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), cookie: login },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  return { db, service, app, req, sleepCalls }
}

/** B站双页 mock(首添 2 页 60 条 → 裁 50)+ acc/info。 */
function biliRoutes(over: { arcFails?: boolean } = {}) {
  return {
    'acc/info?': () => JSON.stringify({ code: 0, data: { name: '某UP', face: 'http://i0.hdslb.com/bfs/face/a.jpg' } }),
    'arc/search?': (url: string) => {
      if (over.arcFails) throw new Error('HTTP 412')
      void url
      return JSON.stringify({ code: 0, data: { list: { vlist: url.includes('pn=2') ? vlist(30, 30) : vlist(0, 30) } } })
    },
  }
}

describe('视频更新:B站 happy path(HTTP 契约 + 裁剪 + 字段改写)', () => {
  let w: World
  beforeAll(async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    w = await makeWorld({ routes: biliRoutes(), bilibiliCookie: 'SESSDATA=xxx; buvid3=yyy' })
    const res = await w.req('POST', '/api/video-updates/bloggers', { url: 'https://space.bilibili.com/2267573' })
    expect(res.status).toBe(201)
    const blogger = (await res.json()) as { platform: string; name: string; avatarUrl: string; categoryId: null }
    // 头像 http→https 改写(研究:mixed-content);归未分类;元信息同步带回
    expect(blogger).toMatchObject({ platform: 'bilibili', name: '某UP', avatarUrl: 'https://i0.hdslb.com/bfs/face/a.jpg', categoryId: null })
    await w.service.idle() // 首取在尾链
  })

  it('feed:60 条裁 50、published_at 倒序、时长两形态解析、缩略图 https', async () => {
    const res = await w.req('GET', '/api/video-updates/videos')
    expect(res.status).toBe(200)
    const feed = (await res.json()) as Array<{ publishedAt: number; durationSeconds: number | null; thumbnailUrl: string }>
    expect(feed).toHaveLength(50)
    expect([...feed].map((v) => v.publishedAt)).toEqual([...feed].map((v) => v.publishedAt).sort((a, b) => b - a))
    // 最新一条 = k=0(偶 → '1:02:39'→3759);最老存留 = k=49(奇 → '24:39'→1479);k≥50 已被裁掉
    expect(feed[0]).toMatchObject({ durationSeconds: 3759, thumbnailUrl: 'https://i2.hdslb.com/bfs/archive/0.jpg' })
    expect(feed[49]!.durationSeconds).toBe(1479)
  })

  it('重复添加同博主 → 409;watch/video 条目页 → 400', async () => {
    await expectError2(await w.req('POST', '/api/video-updates/bloggers', { url: 'https://space.bilibili.com/2267573' }), 409)
    await expectError2(await w.req('POST', '/api/video-updates/bloggers', { url: 'https://www.bilibili.com/video/BV1xx' }), 400)
  })

  it('轮询错峰:B站博主每轮处理前 sleep(5–15s 区间)', async () => {
    expect(w.sleepCalls.length).toBeGreaterThanOrEqual(1) // 首取已含
    for (const ms of w.sleepCalls) {
      expect(ms).toBeGreaterThanOrEqual(5_000)
      expect(ms).toBeLessThanOrEqual(15_000)
    }
  })

  it('删博主:视频级联删(DDL ON DELETE CASCADE)', async () => {
    const count = async () =>
      (await w.db.selectFrom('videos').select(w.db.fn.countAll<number>().as('c')).executeTakeFirstOrThrow()).c
    expect(await count()).toBe(50)
    await w.req('DELETE', '/api/video-updates/bloggers/1')
    expect(await count()).toBe(0)
  })
})

async function expectError2(res: Response, status: number) {
  expect(res.status).toBe(status)
  expect(((await res.json()) as { status: number }).status).toBe(status)
}

describe('视频更新:分类 CRUD 与博主归类', () => {
  let w: World
  let catId: number
  beforeAll(async () => {
    w = await makeWorld({ routes: biliRoutes(), bilibiliCookie: 'SESSDATA=x' })
    const res = await w.req('POST', '/api/video-updates/categories', { name: '技术' })
    expect(res.status).toBe(201)
    catId = ((await res.json()) as { id: number }).id
  })

  it('列表含博主数与未分类计数', async () => {
    await w.req('POST', '/api/video-updates/bloggers', { url: 'https://space.bilibili.com/2267573' })
    const json = (await (await w.req('GET', '/api/video-updates/categories')).json()) as {
      categories: Array<{ name: string; bloggerCount: number }>
      uncategorizedCount: number
    }
    expect(json).toMatchObject({ uncategorizedCount: 1 })
    expect(json.categories[0]).toMatchObject({ name: '技术', bloggerCount: 0 })
  })

  it('博主归类 → feed 带 categoryId;改名/整序;非法分类 404', async () => {
    expect((await w.req('PUT', '/api/video-updates/bloggers/1', { categoryId: catId })).status).toBe(204)
    const feed = (await (await w.req('GET', '/api/video-updates/videos')).json()) as Array<{ categoryId: number | null }>
    expect(feed.every((v) => v.categoryId === catId)).toBe(true)
    expect((await w.req('PUT', '/api/video-updates/bloggers/1', { categoryId: 9999 })).status).toBe(404)
    expect((await w.req('PUT', `/api/video-updates/categories/${catId}`, { name: '科技' })).status).toBe(200)
    expect((await w.req('PUT', '/api/video-updates/categories/reorder', { ids: [catId] })).status).toBe(200)
  })

  it('删分类:博主经 ON DELETE SET NULL 回未分类', async () => {
    expect((await w.req('DELETE', `/api/video-updates/categories/${catId}`)).status).toBe(204)
    const feed = (await (await w.req('GET', '/api/video-updates/videos')).json()) as Array<{ categoryId: number | null }>
    expect(feed.every((v) => v.categoryId === null)).toBe(true)
  })
})

describe('视频更新:B站降级(无 Cookie)与失败标记', () => {
  it('无 Cookie:添加成功(acc/info 匿名),首取失败 fail_streak=1 不删', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const w = await makeWorld({ routes: biliRoutes(), bilibiliCookie: '' })
    expect((await w.req('POST', '/api/video-updates/bloggers', { url: 'https://space.bilibili.com/2267573' })).status).toBe(201)
    await w.service.idle()
    const row = await w.db.selectFrom('video_bloggers').select(['fail_streak', 'status']).executeTakeFirst()
    expect(row).toMatchObject({ fail_streak: 1, status: 'ok' })
    expect(await w.db.selectFrom('videos').select('id').execute()).toEqual([])
  })

  it('连续 24 轮失败标 failing;接口恢复后一轮回 ok', async () => {
    let arcFails = true
    const w = await makeWorld({
      routes: {
        'acc/info?': () => JSON.stringify({ code: 0, data: { name: '某UP', face: '' } }),
        'arc/search?': () => {
          if (arcFails) throw new Error('HTTP 412')
          return JSON.stringify({ code: 0, data: { list: { vlist: vlist(0, 3) } } })
        },
      },
      bilibiliCookie: 'SESSDATA=x',
    })
    await w.req('POST', '/api/video-updates/bloggers', { url: 'https://space.bilibili.com/2267573' })
    await w.service.idle() // 首取失败(1)
    for (let i = 0; i < 23; i++) {
      w.service.pollAllQuietly()
      await w.service.idle()
    }
    expect(await w.db.selectFrom('video_bloggers').select('status').executeTakeFirst()).toMatchObject({ status: 'failing' })
    arcFails = false
    w.service.pollAllQuietly()
    await w.service.idle()
    expect(await w.db.selectFrom('video_bloggers').select(['status', 'fail_streak']).executeTakeFirst()).toMatchObject({ status: 'ok', fail_streak: 0 })
    expect(await w.db.selectFrom('videos').select('id').execute()).toHaveLength(3)
  })
})

describe('视频更新:YouTube 双路线', () => {
  it('无 key:channel 形态页面 og 解析元信息(含头像),RSS 首取(条目无时长)', async () => {
    const w = await makeWorld({
      routes: {
        'youtube.com/channel/UC_x5': () =>
          '<html><head><link rel="canonical" href="https://www.youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw"><meta property="og:title" content="频道现名"><meta property="og:image" content="https://yt3.g/face.jpg"></head></html>',
        'feeds/videos.xml': () =>
          ytRss([
            { id: 'v1', title: '新视频', iso: '2026-08-25T00:00:00Z', author: '频道现名' },
            { id: 'v2', title: '旧视频', iso: '2026-08-20T00:00:00Z', author: '频道现名' },
          ]),
      },
    })
    const res = await w.req('POST', '/api/video-updates/bloggers', { url: 'https://www.youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw' })
    expect(res.status).toBe(201)
    // spec 降级口径:无 key 首添经页面解析拿昵称与头像(spec 评审 c4 修正,不走 RSS 省流量)
    expect(((await res.json()) as { name: string; avatarUrl: string | null })).toMatchObject({
      name: '频道现名',
      avatarUrl: 'https://yt3.g/face.jpg',
    })
    await w.service.idle()
    const feed = (await (await w.req('GET', '/api/video-updates/videos')).json()) as Array<{ durationSeconds: number | null }>
    expect(feed).toHaveLength(2)
    expect(feed.every((v) => v.durationSeconds === null)).toBe(true) // 无 key 存量不回补口径
    // GET /bloggers(spec 路由表漏项的实施补缺):管理 tab 列表
    const list = (await (await w.req('GET', '/api/video-updates/bloggers')).json()) as Array<{ platform: string; name: string }>
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ platform: 'youtube', name: '频道现名' })
  })

  it('有 key:首添走 API 补满 50 带时长;RSS 轮询检出增量再补时长', async () => {
    const rssState = { ids: ['k0', 'k1'] } // 轮询时出现新视频 k2
    const w = await makeWorld({
      youtubeApiKey: STUB_UPSTREAM_KEY,
      routes: {
        'youtube/v3/channels?': () =>
          JSON.stringify({ items: [{ id: 'UC_x5', snippet: { title: '频道', thumbnails: { medium: { url: 'https://yt3.g/240.jpg' } } } }] }),
        'youtube/v3/playlistItems?': () =>
          JSON.stringify({
            items: Array.from({ length: 50 }, (_, i) => ({
              snippet: {
                title: `API 视频${i}`,
                publishedAt: new Date(1_700_000_000_000 - i * 3_600_000).toISOString(),
                resourceId: { videoId: `p${i}` },
                thumbnails: { medium: { url: `https://i.ytimg.com/vi/p${i}/mq.jpg` } },
              },
            })),
          }),
        'youtube/v3/videos?': (url) => {
          // URLSearchParams 把批量 id 的逗号编码为 %2C(YouTube 接受该编码);mock 解码后切分
          const ids = decodeURIComponent(/id=([^&]+)/.exec(url)![1]!).split(',')
          return JSON.stringify({ items: ids.map((id) => ({ id, contentDetails: { duration: 'PT15M33S' } })) })
        },
        'feeds/videos.xml': () =>
          ytRss(rssState.ids.map((id, i) => ({ id, title: `RSS ${id}`, iso: `2026-08-2${5 - i}T00:00:00Z`, author: '频道' }))),
      },
    })
    // 首添(handle 形态 → channels.list 解析,同调用带回头像)
    const res = await w.req('POST', '/api/video-updates/bloggers', { url: 'https://youtube.com/@handle' })
    expect(res.status).toBe(201)
    expect(((await res.json()) as { avatarUrl: string | null }).avatarUrl).toBe('https://yt3.g/240.jpg')
    await w.service.idle()
    let feed = (await (await w.req('GET', '/api/video-updates/videos')).json()) as Array<{ durationSeconds: number | null; url: string }>
    expect(feed).toHaveLength(50)
    expect(feed[0]).toMatchObject({ durationSeconds: 933, url: 'https://www.youtube.com/watch?v=p0' })
    // 轮询:RSS 出现 k0/k1 两条新视频(库内只有 p*),videos.list 补时长后入库,裁剪回 50
    w.service.pollAllQuietly()
    await w.service.idle()
    feed = (await (await w.req('GET', '/api/video-updates/videos')).json()) as Array<{ id: string; url: string; durationSeconds: number | null }>
    expect(feed).toHaveLength(50)
    expect(feed.some((v) => v.url.endsWith('watch?v=k0'))).toBe(true)
  })

  it('无 key 的 handle 形态:页面 canonical + og 一次性解析', async () => {
    const w = await makeWorld({
      routes: {
        'youtube.com/@handle': () =>
          `<html><head><link rel="canonical" href="https://www.youtube.com/channel/UCog"><meta property="og:title" content="页面频道"><meta property="og:image" content="https://yt3.g/og.jpg"></head></html>`,
      },
    })
    const res = await w.req('POST', '/api/video-updates/bloggers', { url: 'https://youtube.com/@handle' })
    expect(res.status).toBe(201)
    expect(((await res.json()) as { platformUserId: string; name: string; avatarUrl: string | null })).toMatchObject({
      platformUserId: 'UCog',
      name: '页面频道',
      avatarUrl: 'https://yt3.g/og.jpg',
    })
  })
})
