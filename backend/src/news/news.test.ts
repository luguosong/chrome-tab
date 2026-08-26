import { describe, expect, it } from 'vitest'
import type { NewsFeedResponse } from 'chrome-tab-shared'
import type { Db } from '../db'
import { NewsService } from './news'
import type { NewsDeps } from './sources/types'
import { expectError, setupApp } from '../testUtils'

/**
 * 路由与调度契约测试(spec「测试」节):假 deps 按 url 分发 fixture、尾链 idle() 对账。
 * 覆盖:空勾选、勾选→首取→feed、非法 id 400、COALESCE 排序、50 条裁剪、48 轮 failing
 * 与自愈、跨用户共享条目池(同源同轮只抓一次)。
 */

/** zhihu fixture:N 条;url 带序号即 item_id。 */
const zhihuJson = (n: number) =>
  JSON.stringify({
    data: Array.from({ length: n }, (_, i) => ({
      target: { title_area: { text: `知乎题${i}` }, link: { url: `https://www.zhihu.com/question/${900000 + i}` } },
    })),
  })

function makeDeps() {
  let zhihuCalls = 0
  let zhihuFails = false
  let zhihuFailNext = 0
  let zhihuCount = 60
  // HN fixture(表格上下文必需,sources.test.ts 同款)+ 假译制器(字典缺条 = 该条译制失败)
  let hnTitles = ['HN 题 A', 'HN 题 B']
  const zhMap = new Map([
    ['HN 题 A', 'HN 题甲译'],
    ['HN 题 B', 'HN 题乙译'],
    ['HN 题 C', 'HN 题丙译'],
  ])
  let translationFails = false
  const translationCalls: string[][] = []
  const deps: NewsDeps = {
    fetchText: async (url: string) => {
      if (url.includes('zhihu.com')) {
        zhihuCalls++
        if (zhihuFails || zhihuFailNext > 0) {
          zhihuFailNext--
          throw new Error('upstream boom')
        }
        return zhihuJson(zhihuCount)
      }
      if (url.includes('news.ycombinator.com')) {
        // item_id 用 title 本身:轮换标题集时不同题不同 id,不被 upsert 防重挡掉
        return `<table>${hnTitles
          .map((t) => `<tr class="athing" id="${t}"><td class="title"><span class="titleline"><a href="x">${t}</a></span></td></tr>`)
          .join('')}</table>`
      }
      if (url.includes('top.baidu.com')) {
        return '<html><!--s-data:{"data":{"cards":[{"content":[{"word":"百度词","rawUrl":"https://b/1"}]}]}}--></html>'
      }
      throw new Error(`unexpected url: ${url}`)
    },
    fetchBuffer: async () => {
      throw new Error('unexpected buffer fetch')
    },
    translateTitles: async (titles) => {
      translationCalls.push(titles)
      if (translationFails) throw new Error('translate boom')
      return titles.map((t) => zhMap.get(t) ?? null)
    },
  }
  return {
    deps,
    calls: () => zhihuCalls,
    failZhihu: (v: boolean) => (zhihuFails = v),
    failZhihuNext: (n: number) => (zhihuFailNext = n),
    setZhihuCount: (n: number) => (zhihuCount = n),
    setHnTitles: (ts: string[]) => (hnTitles = ts),
    failTranslation: (v: boolean) => (translationFails = v),
    translationCalls,
  }
}

describe('新闻路由与调度', () => {
  it('空勾选:feed 空信封', async () => {
    const fake = makeDeps()
    const { login, req } = await setupApp(undefined, (db) => new NewsService(db, fake.deps))
    const cookie = await login()
    const res = await req('GET', '/api/news/feed', { cookie })
    expect(res.status).toBe(200)
    expect((await res.json()) as NewsFeedResponse).toEqual({ items: [], sources: [] })
  })

  it('勾选 → 首取 → feed:裁剪 50、排序 COALESCE、非法 id 400', async () => {
    const fake = makeDeps()
    let service!: NewsService
    const { login, req } = await setupApp(undefined, (db) => (service = new NewsService(db, fake.deps)))
    const cookie = await login()
    await expectError(await req('PUT', '/api/news/sources', { cookie, body: { sources: ['zhihu', 'nope'] } }), 400)

    const put = await req('PUT', '/api/news/sources', { cookie, body: { sources: ['zhihu', 'baidu'] } })
    expect(put.status).toBe(200)
    await service.idle() // 首取排空(zhihu 60 条 + baidu 1 条)

    const feed = (await (await req('GET', '/api/news/feed', { cookie })).json()) as NewsFeedResponse
    expect(feed.sources.map((s) => s.id).sort()).toEqual(['baidu', 'zhihu'])
    expect(feed.sources.every((s) => s.lastSuccessAt && s.status === 'ok')).toBe(true)
    const counts = feed.items.reduce((m, i) => m.set(i.source, (m.get(i.source) ?? 0) + 1), new Map<string, number>())
    expect(counts.get('zhihu')).toBe(50) // 裁剪窗口
    expect(counts.get('baidu')).toBe(1)
  })

  it('排序:published_at 与入库时间代理按数值混排(回归:TEXT 恒压 INTEGER)', async () => {
    const fake = makeDeps()
    let service!: NewsService
    const { login, req } = await setupApp(undefined, (db) => (service = new NewsService(db, fake.deps)))
    const cookie = await login()
    await req('PUT', '/api/news/sources', { cookie, body: { sources: ['zhihu'] } })
    await service.idle()
    const db = (service as unknown as { db: Db }).db
    const nowSec = Math.floor(Date.now() / 1000)
    // 关键回归(code-review):较新的**有**时间条目必须排在较旧入库的**无**时间条目之前——
    // strftime 返回 TEXT,不 cast 成 INTEGER 时 SQLite 混型排序(INTERGER < TEXT)会让
    // 热榜无时间条目恒压一切快讯条目,「全部」流被热榜淹没
    await db
      .insertInto('news_items')
      .values([
        { source: 'zhihu', item_id: 'fresh-timed', title: '刚发布的有时间条目', url: 'https://z/f', published_at: nowSec, created_at: '2026-08-26T00:00:00.000Z' },
        { source: 'zhihu', item_id: 'stale-untimed', title: '十天前入库的无时间条目', url: 'https://z/s', published_at: null, created_at: new Date((nowSec - 10 * 86400) * 1000).toISOString() },
      ])
      .execute()
    const feed = (await (await req('GET', '/api/news/feed', { cookie })).json()) as NewsFeedResponse
    const titles = feed.items.map((i) => i.title)
    expect(titles[0]).toBe('刚发布的有时间条目')
    expect(titles.indexOf('刚发布的有时间条目')).toBeLessThan(titles.indexOf('十天前入库的无时间条目'))
  })

  it('失败计数:48 轮标 failing,成功自愈回 ok', async () => {
    const fake = makeDeps()
    let service!: NewsService
    const { login, req } = await setupApp(undefined, (db) => (service = new NewsService(db, fake.deps)))
    const cookie = await login()
    await req('PUT', '/api/news/sources', { cookie, body: { sources: ['zhihu'] } })
    await service.idle()
    const db = (service as unknown as { db: Db }).db
    await db.updateTable('news_sources').set({ fail_streak: 47 }).execute()
    fake.failZhihu(true)
    service.pollAllQuietly()
    await service.idle()
    let feed = (await (await req('GET', '/api/news/feed', { cookie })).json()) as NewsFeedResponse
    expect(feed.sources[0]).toMatchObject({ id: 'zhihu', status: 'failing' })
    // 自愈:恢复上游,下一轮成功即回 ok 且清零
    fake.failZhihu(false)
    service.pollAllQuietly()
    await service.idle()
    feed = (await (await req('GET', '/api/news/feed', { cookie })).json()) as NewsFeedResponse
    expect(feed.sources[0]).toMatchObject({ id: 'zhihu', status: 'ok' })
  })

  it('首取失败池空时立即补试:补试成功不空窗,双败只计一轮 streak', async () => {
    // 回归(2026-08-26 代理绑架事故的稳定性面):勾选首取若遇瞬时抖动,用户会空 tab
    // 干等下一轮 cron(30min)——池空时补试一次把瞬时失败率平方化
    const fake = makeDeps()
    let service!: NewsService
    const { login, req } = await setupApp(undefined, (db) => (service = new NewsService(db, fake.deps)))
    const cookie = await login()
    // 首抓失败、补试成功:2 次上游调用,feed 有条目、状态 ok
    fake.failZhihuNext(1)
    await req('PUT', '/api/news/sources', { cookie, body: { sources: ['zhihu'] } })
    await service.idle()
    expect(fake.calls()).toBe(2)
    let feed = (await (await req('GET', '/api/news/feed', { cookie })).json()) as NewsFeedResponse
    expect(feed.items.length).toBe(50)
    expect(feed.sources[0]).toMatchObject({ id: 'zhihu', status: 'ok' })
    // 双败:补试也失败不再三试(3 次封顶 → 这里 2 次),streak 只 +1(同一轮口径)
    const db = (service as unknown as { db: Db }).db
    await db.deleteFrom('news_items').execute() // 清池模拟「首取双败」
    await db.deleteFrom('news_sources').execute()
    fake.failZhihuNext(2)
    await req('PUT', '/api/news/sources', { cookie, body: { sources: ['zhihu'] } })
    await service.idle()
    expect(fake.calls()).toBe(4)
    const row = (await db.selectFrom('news_sources').selectAll().where('source', '=', 'zhihu').execute())[0]!
    expect(row.fail_streak).toBe(1)
  })

  it('空结果视为失败;差集替换不清保留源状态、不重抓保留源', async () => {
    const fake = makeDeps()
    let service!: NewsService
    const { login, req } = await setupApp(undefined, (db) => (service = new NewsService(db, fake.deps)))
    const cookie = await login()
    await req('PUT', '/api/news/sources', { cookie, body: { sources: ['zhihu', 'baidu'] } })
    await service.idle()
    // 上游 200 但 0 条(改版/风控墙):视为失败——streak 计数、last_success_at 不刷新
    fake.setZhihuCount(0)
    service.pollAllQuietly()
    await service.idle()
    const db = (service as unknown as { db: Db }).db
    const zhihuRow = (await db.selectFrom('news_sources').selectAll().where('source', '=', 'zhihu').execute())[0]!
    expect(zhihuRow.fail_streak).toBe(1)
    expect(zhihuRow.last_success_at).not.toBeNull() // 失败轮不清既有成功时间
    fake.setZhihuCount(60)
    // 取消勾选 zhihu:保留源 baidu 状态行原样(不重置、不重抓),新勾源才首取
    const before = fake.calls()
    const put = (await (
      await req('PUT', '/api/news/sources', { cookie, body: { sources: ['baidu'] } })
    ).json()) as NewsFeedResponse
    expect(put.sources).toHaveLength(1)
    const baiduRow = (await db.selectFrom('news_sources').selectAll().where('source', '=', 'baidu').execute())[0]!
    expect(baiduRow.last_success_at).not.toBeNull() // 保留源不因改勾选而清零
    await service.idle()
    expect(fake.calls()).toBe(before) // 无新增勾选 → 不投递任何抓取
    // 重勾 zhihu:差集新增 → 首取一次
    await req('PUT', '/api/news/sources', { cookie, body: { sources: ['baidu', 'zhihu'] } })
    await service.idle()
    expect(fake.calls()).toBe(before + 1)
  })

  it('跨用户共享条目池:同源同轮只抓一次,两账号都见到条目', async () => {
    const fake = makeDeps()
    let service!: NewsService
    const { db, login, req } = await setupApp(undefined, (d) => (service = new NewsService(d, fake.deps)))
    const cookie = await login()
    await req('PUT', '/api/news/sources', { cookie, body: { sources: ['zhihu'] } })
    await service.idle()
    // 第二个账号(单账号部署无注册端点,直插 user + 勾选行)
    const { id: user2 } = await db
      .insertInto('users')
      .values({ username: 'u2', password: 'x', created_at: new Date().toISOString() })
      .returning('id')
      .executeTakeFirstOrThrow()
    await db
      .insertInto('news_sources')
      .values({ user_id: user2, source: 'zhihu', enabled: 1, fail_streak: 0, status: 'ok', created_at: new Date().toISOString() })
      .execute()
    const before = fake.calls()
    service.pollAllQuietly()
    await service.idle()
    expect(fake.calls()).toBe(before + 1) // 两账号勾选同源,一轮只抓一次
    const feed2 = await service.feed(user2)
    expect(feed2.items.length).toBe(50)
    expect(feed2.sources[0]).toMatchObject({ id: 'zhihu', status: 'ok' })
  })

  it('英文源标题译制(ADR-0029):feed 拼 titleZh、中文源不译、哈希复用不重译', async () => {
    const fake = makeDeps()
    let service!: NewsService
    const { login, req } = await setupApp(undefined, (db) => (service = new NewsService(db, fake.deps)))
    const cookie = await login()
    await req('PUT', '/api/news/sources', { cookie, body: { sources: ['hackernews', 'zhihu'] } })
    await service.idle()
    let feed = (await (await req('GET', '/api/news/feed', { cookie })).json()) as NewsFeedResponse
    const hn = feed.items.filter((i) => i.source === 'hackernews')
    expect(new Map(hn.map((i) => [i.title, i.titleZh] as const))).toEqual(
      new Map([
        ['HN 题 A', 'HN 题甲译'],
        ['HN 题 B', 'HN 题乙译'],
      ]),
    )
    // 中文源不触发译制:全部 titleZh null,译制器也只收到英文标题
    expect(feed.items.filter((i) => i.source === 'zhihu').every((i) => i.titleZh === null)).toBe(true)
    expect(new Set(fake.translationCalls[0])).toEqual(new Set(['HN 题 A', 'HN 题 B']))
    // 第二轮同题:哈希命中,零译制调用
    service.pollAllQuietly()
    await service.idle()
    expect(fake.translationCalls).toHaveLength(1)
    // 新标题只译缺的那条;字典缺条(null)与译制器抛错都保持英文,已译条目不受影响
    fake.setHnTitles(['HN 题 A', 'HN 题 B', 'HN 题 D'])
    service.pollAllQuietly()
    await service.idle()
    expect(fake.translationCalls).toHaveLength(2)
    expect(fake.translationCalls[1]).toEqual(['HN 题 D'])
    feed = (await (await req('GET', '/api/news/feed', { cookie })).json()) as NewsFeedResponse
    expect(feed.items.find((i) => i.title === 'HN 题 D')!.titleZh).toBeNull()
    expect(feed.items.find((i) => i.title === 'HN 题 A')!.titleZh).toBe('HN 题甲译')
    // 译制器整轮抛错:warn 降级,条目保持英文;直查 fail_streak 断言译制失败不污染取数计数
    fake.failTranslation(true)
    fake.setHnTitles(['HN 题 A', 'HN 题 B', 'HN 题 E'])
    service.pollAllQuietly()
    await service.idle()
    feed = (await (await req('GET', '/api/news/feed', { cookie })).json()) as NewsFeedResponse
    expect(feed.items.find((i) => i.title === 'HN 题 E')!.titleZh).toBeNull()
    const db = (service as unknown as { db: Db }).db
    const hnRow = (await db.selectFrom('news_sources').selectAll().where('source', '=', 'hackernews').execute())[0]!
    expect(hnRow.fail_streak).toBe(0)
  })
})
