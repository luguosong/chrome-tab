import { afterEach, expect, it, vi } from 'vitest'
import { openDb } from './db'
import { ModelTrackingService, normalizeSourcePage } from './modelTracking'
import { ZHIPU_DEF } from './providers/zhipu'
import { DEEPSEEK_DEF } from './providers/deepseek'

afterEach(() => vi.useRealTimers())

it('定时轮按 last_attempt 分三档跳过，重启仍守档位，慢档健康不受发布失败影响', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-13T00:00:00Z'))
  const { db } = openDb(':memory:')
  const fetchText = vi.fn(async () => '官方资料')
  const deps = { fetchText, env: {} }
  const svc = new ModelTrackingService(db, deps)
  await svc.pollProvider()
  const status = () => db.selectFrom('model_fetch_status').selectAll().where('provider', '=', 'zhipu').execute()
  expect(await status()).toHaveLength(6)
  const first = await status()
  expect(first.find((s) => s.role === 'pricing')).toMatchObject({ stale: 0 })
  expect(first.find((s) => s.role === 'release')).toMatchObject({ stale: 1 })
  fetchText.mockClear()
  vi.setSystemTime(new Date('2026-09-13T01:59:59Z'))
  await new ModelTrackingService(db, deps).pollProvider()
  expect(fetchText).not.toHaveBeenCalled()
  vi.setSystemTime(new Date('2026-09-13T02:00:00Z'))
  await svc.pollProvider()
  expect((await status()).find((s) => s.role === 'catalog')!.last_attempt_at).toBe('2026-09-13T00:00:00.000Z')
  expect((await status()).find((s) => s.role === 'release')!.last_attempt_at).toBe('2026-09-13T02:00:00.000Z')
  vi.setSystemTime(new Date('2026-09-13T06:00:00Z'))
  await svc.pollProvider()
  expect((await status()).find((s) => s.role === 'catalog')!.last_attempt_at).toBe('2026-09-13T06:00:00.000Z')
  expect((await status()).find((s) => s.role === 'pricing')).toMatchObject({ stale: 0, last_attempt_at: '2026-09-13T00:00:00.000Z' })
  vi.setSystemTime(new Date('2026-09-14T00:00:00Z'))
  await svc.pollProvider()
  expect((await status()).find((s) => s.role === 'pricing')!.last_attempt_at).toBe('2026-09-14T00:00:00.000Z')
  await db.destroy()
})

it('失败只标当前角色陈旧，保留快照与成功时间，下一档到期成功后恢复', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-13T00:00:00Z'))
  const { db } = openDb(':memory:')
  let fail = false
  const svc = new ModelTrackingService(db, { env: {}, fetchText: async (url) => {
    if (fail && url === ZHIPU_DEF.sources.pricing.urls[0]) throw new Error('HTTP 503')
    return '官方资料'
  } })
  const pricing = () => db.selectFrom('model_fetch_status').selectAll().where('provider', '=', 'zhipu').where('role', '=', 'pricing').executeTakeFirstOrThrow()
  await svc.pollProvider()
  const original = await pricing()
  fail = true
  vi.setSystemTime(new Date('2026-09-14T00:00:00Z'))
  await svc.pollProvider()
  expect(await pricing()).toMatchObject({ stale: 1, pages: original.pages, fingerprint: original.fingerprint, last_success_at: original.last_success_at })
  expect(await db.selectFrom('model_fetch_status').select('stale').where('provider', '=', 'zhipu').where('role', '=', 'limits').executeTakeFirstOrThrow()).toEqual({ stale: 0 })
  fail = false
  vi.setSystemTime(new Date('2026-09-14T02:00:00Z'))
  await svc.pollProvider()
  expect((await pricing()).stale).toBe(1) // 失败也按 last_attempt 退避，不能在快档密集重试
  vi.setSystemTime(new Date('2026-09-15T00:00:00Z'))
  await svc.pollProvider()
  expect(await pricing()).toMatchObject({ stale: 0, last_success_at: '2026-09-15T00:00:00.000Z' })
  await db.destroy()
})

it('HTML 页指纹只认正文变化，页面脚本变化不触发重核', async () => {
  vi.useFakeTimers()
  const { db } = openDb(':memory:')
  let script = 'a', price = '1'
  // deepseek pricing 声明 html: true(声明驱动净化);zhipu 各档是 .md 不走净化。
  // release 页单独给可解析 HTML,避免单家轮被「发布源无结构化条目」直抛中断。
  const releases = '<html><body><main><h2 id="d">Date: 2026-09-13</h2><h3 id="a">DeepSeek-V4.2 发布</h3></main></body></html>'
  const pricingUrl = 'https://api-docs.deepseek.com/quick_start/pricing'
  const svc = new ModelTrackingService(db, { env: {}, fetchText: async (url) =>
    url === pricingUrl
      ? `<html><head><script>${script}</script></head><body><main>价格 ${price} 元</main></body></html>`
      : url === 'https://api-docs.deepseek.com/quick_start/rate_limit'
        ? '<html><body><main>限额正文</main></body></html>'
        : releases,
  })
  const pricing = () => db.selectFrom('model_fetch_status').select(['pages', 'fingerprint']).where('provider', '=', 'deepseek').where('role', '=', 'pricing').executeTakeFirstOrThrow()
  vi.setSystemTime(new Date('2026-09-13T00:00:00Z'))
  await svc.pollProvider('deepseek')
  const first = await pricing()
  script = 'b'
  vi.setSystemTime(new Date('2026-09-14T00:00:00Z'))
  await svc.pollProvider('deepseek')
  expect(await pricing()).toEqual(first)
  price = '2'
  vi.setSystemTime(new Date('2026-09-15T00:00:00Z'))
  await svc.pollProvider('deepseek')
  expect((await pricing()).fingerprint).not.toBe(first.fingerprint)
  await db.destroy()
})

it('健康预算按角色区分：同为 7 小时前成功，目录陈旧而价格仍新鲜', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-13T07:00:00Z'))
  const { db } = openDb(':memory:')
  for (const role of ['catalog', 'pricing']) await db.insertInto('model_fetch_status').values({
    provider: 'zhipu', role, stale: 0, last_success_at: '2026-09-13T00:00:00.000Z',
    last_attempt_at: '2026-09-13T06:00:00.000Z',
  }).execute()
  await new ModelTrackingService(db, { env: {}, fetchText: async () => '官方资料' }).pollProvider()
  const rows = await db.selectFrom('model_fetch_status').select(['role', 'stale']).where('provider', '=', 'zhipu').execute()
  expect(rows).toEqual(expect.arrayContaining([{ role: 'catalog', stale: 1 }, { role: 'pricing', stale: 0 }]))
  await db.destroy()
})

it('同一 URL 双角色(deepseek updates 页)存储形态统一：release 行存规范化文本而非原始 HTML', async () => {
  const { db } = openDb(':memory:')
  // deepseek updates 页同时注册 release(解析消费 raw)与 retirement(指纹档)——
  // 两角色存储形态不一会让按 URL 合并的影子快照随轮换角色翻转基准，零上游变化也翻指纹
  const html = '<html><head><script>bundle-v1</script></head><body><main><h2 id="date-2026-09-13">Date: 2026-09-13</h2><h3 id="a">DeepSeek-V4.2 发布</h3></main></body></html>'
  const svc = new ModelTrackingService(db, { env: {}, fetchText: async () => html })
  await svc.pollProvider('deepseek')
  const row = (role: string) => db.selectFrom('model_fetch_status').select('pages')
    .where('provider', '=', 'deepseek').where('role', '=', role).executeTakeFirstOrThrow()
  for (const role of ['release', 'retirement']) {
    const pages = JSON.parse((await row(role)).pages!) as Record<string, string>
    expect(pages['https://api-docs.deepseek.com/updates/']).not.toContain('<') // 两角色同为规范化文本
  }
  await db.destroy()
})

it('normalizeSourcePage 由 def 声明驱动：html 页净化（main 内语义 header 保留），md 页含字面标签也不误报', async () => {
  // html 声明的页:剥脚本与框架层,取正文;无 <html> 字面标签的 HTML5 照样净化
  const bare = '<!doctype html><script>bundle-v1</script><body><main>价格 1 元</main></body>'
  expect(normalizeSourcePage(bare, true)).toBe('价格 1 元')
  // main 内的语义 header(定价表引言)是正文，不被页面框架剥除吞掉——否则真实变化静默漂移
  const semantic = '<html><body><main><header>上下文 128K</header><footer>更新于 9 月</footer></main></body></html>'
  expect(normalizeSourcePage(semantic, true)).toContain('上下文 128K')
  expect(normalizeSourcePage(semantic, true)).toContain('更新于 9 月')
  // 页面框架层(body 直接子级 header/footer/nav)照剥
  expect(normalizeSourcePage('<html><body><nav>导航</nav><main>正文</main></body></html>', true)).toBe('正文')
  // .md 信源页(未声明 html)含 <meta>/<title> 字面示例也原样保留——启发式误报会让存储
  // 形态被 cheerio 重写、markdown 结构塌缩,一次指纹翻转触发全厂家重核
  const md = '# 文档\n\n```html\n<meta name="x"><title>y</title>\n```\n'
  expect(normalizeSourcePage(md, false)).toBe(md)
})

it('多页角色逐页容错：单页失败沿用旧快照稳指纹，全败才标角色陈旧', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-13T00:00:00Z'))
  const { db } = openDb(':memory:')
  // deepseek weights 两页：第二页(HF 仓库改名)持续 404
  const urls = DEEPSEEK_DEF.sources.weights.urls
  const svc = new ModelTrackingService(db, { env: {}, fetchText: async (url) =>
    url === urls[1] ? Promise.reject(new Error('HTTP 404')) : `权重页 ${url}`,
  })
  const weights = () => db.selectFrom('model_fetch_status').selectAll()
    .where('provider', '=', 'deepseek').where('role', '=', 'weights').executeTakeFirstOrThrow()
  await svc.pollProvider()
  const original = await weights()
  expect(original.stale).toBe(0) // 单页失败不弃整轮
  expect(JSON.parse(original.pages!)).toHaveProperty(urls[0]!)
  vi.setSystemTime(new Date('2026-09-14T00:00:00Z'))
  await svc.pollProvider()
  const second = await weights()
  // 成功页新内容 + 失败页沿用旧内容 → 指纹不因间歇失败翻转
  expect(second.fingerprint).toBe(original.fingerprint)
  expect(second.stale).toBe(0)
  await db.destroy()
})

it('手动强制刷新不等同于在飞轮：cron 轮已按档位跳过 release 时，强制轮仍真实抓取', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-13T00:00:00Z'))
  const { db } = openDb(':memory:')
  let releaseFetches = 0
  const gate = { resolve: (_: string) => {} }
  const slow = new Promise<string>((r) => { gate.resolve = r })
  const zhipuMd = '# 智谱发布\n\n<Update label="2026-09-12" description="GLM-5.4 发布">[GLM-5.4](https://docs.zhipu.com/glm-5-4)</Update>\n'
  const svc = new ModelTrackingService(db, { env: {}, fetchText: async (url) => {
    if (url === ZHIPU_DEF.sources.release.urls[0]) {
      releaseFetches++
      if (releaseFetches === 1) return slow // 首轮 release 抓取挂起，让 cron 轮在飞
      return zhipuMd
    }
    return '官方资料'
  } })
  const inFlight = svc.pollProvider() // cron 全量轮在飞(非 release 角色也被 gate 前的快路径占住轮询槽)
  const forced = svc.pollProvider('zhipu') // 运维强制补轮：不得被在飞轮静默吞掉
  gate.resolve(zhipuMd)
  await Promise.all([inFlight, forced])
  expect(releaseFetches).toBe(2) // 强制轮真实重抓了 release
  await db.destroy()
})

it('同 URL 多角色共注册一轮只抓一次(深求 updates 页 release+retirement 走轮级缓存)', async () => {
  const { db } = openDb(':memory:')
  const updates = 'https://api-docs.deepseek.com/updates/'
  const html = '<html><body><main><h2 id="d">Date: 2026-09-13</h2><h3 id="a">DeepSeek-V4.2 发布</h3></main></body></html>'
  const fetchText = vi.fn(async (_url: string) => html)
  await new ModelTrackingService(db, { env: {}, fetchText }).pollProvider('deepseek')
  expect(fetchText.mock.calls.filter((c) => c[0] === updates)).toHaveLength(1)
  await db.destroy()
})

it('HTML 发布页正文全在框架层:规范化后为空不入库,release 标陈旧而非带空快照标健康', async () => {
  const { db } = openDb(':memory:')
  // h2/h3 结构在(解析器命中)但正文全在 body 直接子级 nav 里——normalize 后为空
  const nav = '<html><body><nav><h2 id="d">Date: 2026-09-13</h2><h3 id="a">DeepSeek-V4.2 发布</h3></nav></body></html>'
  const svc = new ModelTrackingService(db, { env: {}, fetchText: async () => nav })
  await expect(svc.pollProvider('deepseek')).rejects.toThrow('信源页为空')
  const row = await db.selectFrom('model_fetch_status').select(['stale', 'pages'])
    .where('provider', '=', 'deepseek').where('role', '=', 'release').executeTakeFirstOrThrow()
  expect(row).toMatchObject({ stale: 1, pages: null })
  await db.destroy()
})

it('单页角色有旧快照时瞬时全败:抛真实错误(非 undefined)且角色标陈旧保留快照', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-13T00:00:00Z'))
  const { db } = openDb(':memory:')
  let fail = false
  const svc = new ModelTrackingService(db, { env: {}, fetchText: async () => {
    if (fail) throw new Error('HTTP 503')
    return '官方资料'
  } })
  await svc.pollProvider().catch(() => {})
  const original = await db.selectFrom('model_fetch_status').select(['pages', 'fingerprint'])
    .where('provider', '=', 'zhipu').where('role', '=', 'pricing').executeTakeFirstOrThrow()
  fail = true
  const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    vi.setSystemTime(new Date('2026-09-14T00:00:00Z'))
    await svc.pollProvider().catch(() => {})
    // 回退与收集分立:瞬时全败的 pageErrs[0] 是真实错误,排障可见
    expect(errSpy.mock.calls.some((c) => c.some((a) => String(a).includes('HTTP 503')))).toBe(true)
    const row = await db.selectFrom('model_fetch_status').selectAll()
      .where('provider', '=', 'zhipu').where('role', '=', 'pricing').executeTakeFirstOrThrow()
    expect(row).toMatchObject({ stale: 1, pages: original.pages, fingerprint: original.fingerprint })
  } finally {
    errSpy.mockRestore()
  }
  await db.destroy()
})

it('在飞轮落定不误删排队轮登记:连续强制补轮串行,无并发双写', async () => {
  const { db } = openDb(':memory:')
  const releaseUrl = ZHIPU_DEF.sources.release.urls[0]!
  const zhipuMd = '# 智谱发布\n\n<Update label="2026-09-12" description="GLM-5.4 发布">[GLM-5.4](https://docs.zhipu.com/glm-5-4)</Update>\n'
  let releaseFetches = 0
  const gates: Array<(v: string) => void> = []
  const svc = new ModelTrackingService(db, { env: {}, fetchText: async (url) => {
    if (url === releaseUrl) {
      const n = releaseFetches++
      if (n < 2) return new Promise<string>((r) => { gates.push(r) }) // 前两轮抓取挂起
      return zhipuMd
    }
    return '官方资料'
  } })
  const roundA = svc.pollProvider() // cron 轮在飞(挂于第一次 release 抓取)
  const roundB = svc.pollProvider('zhipu') // 强制一:排队
  await new Promise((r) => setTimeout(r, 10))
  gates[0]!(zhipuMd) // A 落定 → B 开始,挂于第二次 release 抓取
  await new Promise((r) => setTimeout(r, 10))
  const roundC = svc.pollProvider('zhipu') // 强制二:B 在飞,A 的 finally 不得删掉 B 的登记
  await new Promise((r) => setTimeout(r, 10))
  expect(releaseFetches).toBe(2) // C 排队等待而非并发起跑
  gates[1]!(zhipuMd) // B 落定 → C 开始,第三次抓取直接返回
  await Promise.all([roundA, roundB, roundC])
  expect(releaseFetches).toBe(3)
  await db.destroy()
})

it('抓取有耗时且 cron 有毫秒抖动时，相邻 2h 轮不能误跳过', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-13T00:41:00.010Z'))
  const { db } = openDb(':memory:')
  const svc = new ModelTrackingService(db, { env: {}, fetchText: async () => {
    vi.setSystemTime(Date.now() + 1000)
    return '官方资料'
  } })
  const attempt = () => db.selectFrom('model_fetch_status').select('last_attempt_at').where('provider', '=', 'zhipu').where('role', '=', 'release').executeTakeFirstOrThrow()
  await svc.pollProvider()
  expect((await attempt()).last_attempt_at).toBe('2026-09-13T00:41:00.000Z')
  vi.setSystemTime(new Date('2026-09-13T02:41:00.001Z'))
  await svc.pollProvider()
  expect((await attempt()).last_attempt_at).toBe('2026-09-13T02:41:00.000Z')
  await db.destroy()
})
