import { afterEach, describe, expect, it, vi } from 'vitest'
import { openDb } from './db'
import { ModelTrackingService, normalizeSourcePage, PROVIDERS } from './modelTracking'
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

// ---- 票 07:目录差集与退役监视(逐家解析器纯函数 + 差集/线索生成 + 服务接线)----

import { catalogDiffClues, makeCatalogResolver, retirementClues, retirementFromTitles, deprecationTableIds, datedSectionsToRetirements } from './providers/def'
import { parseZhipuCatalog, ZHIPU_OVERVIEW_URL } from './providers/zhipu'
import { parseAnthropicCatalog } from './providers/anthropic'
import { parseXaiCatalog } from './providers/xai'
import { parseMoonshotCatalog, parseMoonshotRetirements, KIMI_MODELS_URL, KIMI_NEWS_URL, KIMI_BLOG_URL } from './providers/moonshot'
import { parseOpenAICatalog, OPENAI_MODELS_URL } from './providers/openai'
import { parseDeepSeekCatalog } from './providers/deepseek'
import { parseBailianCatalog } from './providers/alibaba'
import type { ModelTrackingDeps } from './modelTracking'

/** 月暗文章页最小可解析形态(单卡:锚点 aria-label 即标题,card-title 后首个 ISO 日期)。 */
const KIMI_ONE_CARD_HTML = '<a href="/news/kimi-k3" aria-label="Kimi K3 发布" class="absolute inset-0 z-[1]"></a><div class="card-body"><h4 class="card-title">Kimi K3 发布</h4><span>2026-09-01</span></div>'

/** 票 07 月暗服务测试共 harness:models.md 可控 + 文章页最小可解析,其余 URL 404。 */
function moonshotDeps(modelsMd: string): ModelTrackingDeps {
  return {
    env: {},
    fetchText: async (url) => {
      if (url === KIMI_MODELS_URL) return modelsMd
      if (url === KIMI_NEWS_URL || url === KIMI_BLOG_URL) return KIMI_ONE_CARD_HTML
      throw new Error('HTTP 404')
    },
  }
}

describe('票 07:目录差集归并解析器(纯函数)', () => {
  const rows = [
    { officialId: 'kimi-k3', matchAliases: ['Kimi K3'] },
    { officialId: 'kimi-k2', matchAliases: ['Kimi K2'] },
    { officialId: 'glm-4.7-flash', matchAliases: ['GLM-4.7-Flash'] },
  ]
  it('键集含 officialId:API ID 目录页(月暗)靠 officialId 半边归并,alias 展示名不够用', () => {
    const resolve = makeCatalogResolver(rows)
    expect(resolve('kimi-k3')).toBe('kimi-k3') // 精确 officialId
    expect(resolve('Kimi K3')).toBe('kimi-k3') // 精确 alias
    expect(resolve('kimi-k2-0905-preview')).toBe('kimi-k2') // 前缀连字符:日期快照归家族
    expect(resolve('glm-4.7-flash-preview')).toBe('glm-4.7-flash')
    expect(resolve('kimi-k3.5')).toBeNull() // 名称相近非前缀连字符形态:仅认厂家明确关系,不归并
    expect(resolve('GLM-9.9')).toBeNull()
  })
  it('差集线索:未归并 ID 逐个一条(标题=目录在册),-latest 引用别名与已归并 ID 不落', () => {
    const clues = catalogDiffClues(
      ['kimi-k3', 'kimi-k4', 'kimi-k4', 'kimi-latest', 'chatgpt-4o-latest'],
      rows,
      { occurredOn: '2026-09-13', sourceUrl: 'https://example.com/catalog' },
    )
    expect(clues).toEqual([{
      occurredOn: '2026-09-13',
      title: 'kimi-k4:官方目录在册',
      sourceUrl: 'https://example.com/catalog',
      modelKey: 'kimi-k4',
    }])
  })
})

describe('票 07:退役线索生成(纯函数)', () => {
  const rows = [
    { officialId: 'grok-imagine-image-quality', matchAliases: ['grok-imagine-image-quality'], matchSlugs: [] },
    { officialId: 'kimi-k2.5', matchAliases: ['Kimi K2.5'], matchSlugs: [] },
  ]
  it('候选 = 条目结构 ID ∪ 标题别名命中;-latest 不算,同 ID 取首条', () => {
    const clues = retirementClues([
      { occurredOn: '2026-11-02', title: 'grok-imagine-image-quality retirement on November 2', modelIds: [] },
      { occurredOn: '2026-08-31', title: 'kimi-k2.5 与 moonshot-v1 系列已下线(重复条目)', modelIds: ['kimi-k2.5'] },
      { occurredOn: '2026-09-01', title: 'kimi-k2.5 再度公告(应取首条 08-31)', modelIds: ['kimi-k2.5'] },
      { occurredOn: '2026-09-02', title: 'chat-latest 弃用(-latest 引用别名不落)', modelIds: ['gpt-chat-latest'] },
    ], rows, 'https://example.com/retire')
    expect(clues.map((c) => [c.modelKey, c.occurredOn])).toEqual([
      ['grok-imagine-image-quality', '2026-11-02'], // 标题别名命中(发布流式公告型号在标题)
      ['kimi-k2.5', '2026-08-31'], // 结构 ID;重复条目取首条
    ])
  })
  it('发布流标题词面筛(召回闸):退役词面进,普通发布不进', () => {
    const entries = retirementFromTitles([
      { occurredOn: '2026-09-01', title: 'Grok 4.6 is available' },
      { occurredOn: '2026-09-01', title: 'grok-imagine-image-quality retirement on November 2' },
      { occurredOn: '2026-08-20', title: 'DeepSeek-V2.5 停用公告' },
      { occurredOn: '2026-08-01', title: 'Legacy audio models deprecation notice' },
    ])
    expect(entries.map((e) => e.title)).toHaveLength(3)
    expect(entries.every((e) => e.modelIds.length === 0)).toBe(true) // 型号归标题别名命中补齐
  })
  it('弃用公告表格次列提取:模型列进、替代列不进、平台段(次列 Update)无 ID', () => {
    const section = [
      'The `gpt-5.4-cyber` model is deprecated and will be removed.',
      '',
      '| Shutdown date | Model / system  | Recommended replacement |',
      '| ------------- | --------------- | ----------------------- |',
      '| Oct 1, 2026   | `gpt-5.4-cyber` | `gpt-5.6-cyber`         |',
      '| Oct 1, 2026   | `gpt-audio-1.5` | `gpt-audio-2`           |',
      '',
      '| Date         | Update                            |',
      '| ------------ | --------------------------------- |',
      '| Jun 3, 2026  | Reusable prompts `v1/prompts` out |',
    ].join('\n')
    expect(deprecationTableIds(section)).toEqual(['gpt-5.4-cyber', 'gpt-audio-1.5'])
  })
})

describe('票 07:逐家目录页解析(纯函数,2026-09-13 实抓节选)', () => {
  it('智谱:模型表格首列链接名;裸名与卡片 JSX 不依赖', () => {
    const md = [
      '<Card title="GLM-5.3" icon={<svg className="x"/>} href="/cn/guide/models/text/glm-5.3">',
      '  **旗舰模型**',
      '</Card>',
      '',
      '| 模型 | 特点 |',
      '| :-- | :-- |',
      '| [GLM-5.3](/cn/guide/models/text/glm-5.3) | 旗舰模型 |',
      '| [GLM-5.2](/cn/guide/models/text/glm-5.2) | 支撑复杂长程任务 |',
      '| [Vidu Q1](/cn/guide/models/video-generation/viduq1) | 高质量视频生成模型 |',
      '| CodeGeeX-4 | 代码补全模型(裸名无链接不收) |',
    ].join('\n')
    expect(parseZhipuCatalog(md).entries.sort()).toEqual(['GLM-5.2', 'GLM-5.3', 'Vidu Q1'])
  })
  it('Anthropic:Claude API ID 行反引号值', () => {
    const md = [
      '| Feature | A | B |',
      '| :-- | :-- | :-- |',
      '| Claude API ID | `claude-fable-5-1` | `claude-haiku-4-5-20251001` |',
      '| Context window | 1M tokens | 200K tokens |',
    ].join('\n')
    expect(parseAnthropicCatalog(md).entries).toEqual(['claude-fable-5-1', 'claude-haiku-4-5-20251001'])
  })
  it('xAI:长上下文行剥计价括号取裸名;语音模式行取括号 ID 弃模式标签;表头排除', () => {
    const md = [
      '| Model | Context |',
      '| --- | --- |',
      '| grok-4.6 (< 200k prompt tokens) | 500k |',
      '| grok-4.6 (≥ 200k prompt tokens) | 500k |',
      '| grok-imagine-image-quality | $0.05 / image |',
      '',
      '| Mode | Cost |',
      '| --- | --- |',
      '| Speech to Speech (grok-voice-think-fast-2.0) | $0.08 / min |',
      '| Speech to Text | $0.10 / hr |',
    ].join('\n')
    expect([...parseXaiCatalog(md).entries].sort()).toEqual(['Speech to Text', 'grok-4.6', 'grok-imagine-image-quality', 'grok-voice-think-fast-2.0'])
  })
  it('月暗:全页反引号小写 ID(在售与已下线同收,已下线经归并解析不产差集)', () => {
    const md = [
      '<Warning>',
      '  `kimi-k2.5` 和 `moonshot-v1` 系列模型已于 2026 年 8 月 31 日正式下线。',
      '</Warning>',
      '',
      '| 模型名称 | 描述 |',
      '| --- | --- |',
      '| `kimi-k3` | 旗舰模型 |',
      '| `kimi-latest` | 移动别名 |',
    ].join('\n')
    expect([...parseMoonshotCatalog(md).entries].sort()).toEqual(['kimi-k2.5', 'kimi-k3', 'kimi-latest', 'moonshot-v1'])
  })
  it('月暗退役:含「下线」且带中文日期的行 → 条目;无日期机制说明行排除', () => {
    const md = [
      '> `kimi-k2.5` 已于 **2026 年 8 月 31 日下线**,不再维护和支持。请使用 `kimi-k3`。',
      '> `moonshot-v1` 系列模型(含 `moonshot-v1-auto`)已于 **2026 年 8 月 31 日下线**。',
      '> 下线模型将逐步缩减 QPM。(机制说明,无日期)',
      '> `kimi-k2` 系列模型已于 **2026 年 5 月 25 日**下线。',
    ].join('\n')
    const r = parseMoonshotRetirements(md)
    expect(r.entries).toEqual([
      { occurredOn: '2026-08-31', title: 'kimi-k2.5 已于 2026 年 8 月 31 日下线,不再维护和支持。请使用 kimi-k3。', modelIds: ['kimi-k2.5', 'kimi-k3'] },
      { occurredOn: '2026-08-31', title: 'moonshot-v1 系列模型(含 moonshot-v1-auto)已于 2026 年 8 月 31 日下线。', modelIds: ['moonshot-v1', 'moonshot-v1-auto'] },
      { occurredOn: '2026-05-25', title: 'kimi-k2 系列模型已于 2026 年 5 月 25 日下线。', modelIds: ['kimi-k2'] },
    ])
  })
  it('OpenAI:models/<slug>.md 链接 slug;弃用段 = 表格次列 ∪ 标题反引号,平台段与无日期段排除', () => {
    const catalog = [
      '- [GPT-6 Astra](/api/docs/models/gpt-6-astra.md): most capable',
      '- [GPT-5.4 Cyber](/api/docs/models/gpt-5.4-cyber.md): cybersecurity',
      'If you\'re not sure, use [GPT-6 Astra](/api/docs/models/gpt-6-astra).',
    ].join('\n')
    expect([...parseOpenAICatalog(catalog).entries].sort()).toEqual(['gpt-5.4-cyber', 'gpt-6-astra'])
    const deprecations = [
      '# Deprecations',
      '',
      '## Upcoming deprecations',
      '',
      '### 2026-09-11: GPT-5.4-Cyber',
      '',
      'The `gpt-5.4-cyber` model is deprecated.',
      '',
      '| Shutdown date | Model / system  | Recommended replacement |',
      '| ------------- | --------------- | ----------------------- |',
      '| Oct 1, 2026   | `gpt-5.4-cyber` | `gpt-5.6-cyber`         |',
      '',
      '### 2026-06-03: Reusable prompts',
      '',
      '| Date | Update |',
      '| ---- | ------ |',
      '| Jun 3, 2026 | Prompts are now reusable. |',
      '',
      '### 2026-05-08: `gpt-5.2-chat-latest` model snapshots',
      '',
      'Snapshots are deprecated.',
      '',
      '### Update to OpenAI’s self-serve fine-tuning',
      '',
      'Undated platform section.',
    ].join('\n')
    const r = datedSectionsToRetirements(deprecations)
    expect(r.entries).toEqual([
      { occurredOn: '2026-09-11', title: 'GPT-5.4-Cyber', modelIds: ['gpt-5.4-cyber'] },
      { occurredOn: '2026-06-03', title: 'Reusable prompts', modelIds: [] },
      { occurredOn: '2026-05-08', title: '`gpt-5.2-chat-latest` model snapshots', modelIds: ['gpt-5.2-chat-latest'] },
    ])
  })
  it('弃用段共用件(Anthropic 形态):三列表次列;畸形日期落意外跳过', () => {
    const md = [
      '## Deprecation history',
      '',
      '### 2026-06-05: Claude Opus 4.1 model',
      '',
      '| Retirement date | Deprecated model           | Recommended replacement |',
      '| --------------- | -------------------------- | ----------------------- |',
      '| August 5, 2026  | `claude-opus-4-1-20250805` | `claude-opus-4-8`       |',
      '',
      '### 2026-13-45: 畸形日期段',
      '',
      '| Retirement date | Deprecated model |',
      '| --- | --- |',
      '| X | `claude-ghost` |',
    ].join('\n')
    const r = datedSectionsToRetirements(md)
    expect(r.entries).toEqual([
      { occurredOn: '2026-06-05', title: 'Claude Opus 4.1 model', modelIds: ['claude-opus-4-1-20250805'] },
    ])
    expect(r.skipped).toHaveLength(1) // 日期形态但回滚校验失败
  })
  it('DeepSeek:转置表 MODEL/MODEL VERSION 行的非首格(脚注角标剥除)', () => {
    const html = [
      '<table>',
      '<tr><td>MODEL</td><td>deepseek-flash<sup>(1)</sup></td><td>deepseek-v4-pro<sup>(2)</sup></td></tr>',
      '<tr><td>BASE URL</td><td>https://api.deepseek.com</td></tr>',
      '<tr><td>MODEL VERSION</td><td>DeepSeek-V4.1-Flash</td><td>DeepSeek-V4-Pro-0813</td></tr>',
      '<tr><td>CONTEXT LENGTH</td><td>1M</td></tr>',
      '</table>',
    ].join('')
    expect([...parseDeepSeekCatalog(html).entries].sort()).toEqual(['DeepSeek-V4-Pro-0813', 'DeepSeek-V4.1-Flash', 'deepseek-flash', 'deepseek-v4-pro'])
  })
  it('通义:正文 token 形态(必含段界与数字);纯单词栏目名、无数字路径段排除', () => {
    const html = '<html><body><main>文本生成 qwen3.8-max qwen3.7-plus deepseek-v4-pro-0813 kimi/kimi-k3 ASR TTS 查看更多 2026 首页 zh/model-studio quick_start/pricing </main></body></html>'
    expect([...parseBailianCatalog(html).entries].sort()).toEqual(['deepseek-v4-pro-0813', 'kimi/kimi-k3', 'qwen3.7-plus', 'qwen3.8-max'])
  })
})

describe('票 07:目录差集与退役监视服务接线(种子基线差集)', () => {
  it('目录差集:目录在册而种子无认领的 ID 落线索库(月暗豁免取消后该家首个真线索通道)', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-13T00:00:00Z'))
    try {
      const { db } = openDb(':memory:')
      const modelsMd = [
        '# 模型列表',
        '',
        '| 模型名称 | 描述 |',
        '| --- | --- |',
        '| `kimi-k3` | 旗舰 |',
        '| `kimi-k2.6` | 多模态 |',
        '| `kimi-k9` | 全新模型 |',
        '| `kimi-latest` | 移动别名 |',
      ].join('\n')
      const svc = new ModelTrackingService(db, moonshotDeps(modelsMd))
      await svc.init()
      await svc.pollProvider('moonshot')
      const clues = await db.selectFrom('model_pending_clues').selectAll().where('provider', '=', 'moonshot').execute()
      expect(clues.map((c) => [c.model_key, c.occurred_on])).toEqual([['kimi-k9', '2026-09-13']])
      expect(clues[0]!.title).toBe('kimi-k9:官方目录在册')
      expect(clues[0]!.source_url).toBe(KIMI_MODELS_URL)
      await db.destroy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('退役监视:官方弃用公告条目产退役线索进同一账本(30 天窗外历史公告不触达)', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-13T00:00:00Z'))
    try {
      const { db } = openDb(':memory:')
      const modelsMd = [
        '# 模型列表',
        '',
        '> `kimi-k2.5` 已于 **2026 年 8 月 31 日下线**,不再维护和支持。',
        '> `kimi-k2` 系列模型已于 **2026 年 5 月 25 日下线**(30 天窗外,不落)。',
      ].join('\n')
      const svc = new ModelTrackingService(db, moonshotDeps(modelsMd))
      await svc.init()
      await svc.pollProvider('moonshot')
      const clues = await db.selectFrom('model_pending_clues').selectAll().where('provider', '=', 'moonshot').execute()
      // kimi-k2.5(种子 stage=deprecated,官方已下线)进线索;kimi-k2 公告在 30 天窗外被账本入库窗拦下
      expect(clues.map((c) => [c.model_key, c.occurred_on])).toEqual([['kimi-k2.5', '2026-08-31']])
      expect(clues[0]!.source_url).toBe(KIMI_MODELS_URL)
      await db.destroy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('退役判定只认官方文字:型号出目录不产任何线索(差集只做加法)', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-13T00:00:00Z'))
    try {
      const { db } = openDb(':memory:')
      // 目录只剩 kimi-k3:kimi-k2.6「消失」了——页面消失不是观察,不产退役/任何线索
      const modelsMd = '# 模型列表\n\n| 模型名称 |\n| --- |\n| `kimi-k3` |\n'
      const svc = new ModelTrackingService(db, moonshotDeps(modelsMd))
      await svc.init()
      await svc.pollProvider('moonshot')
      const clues = await db.selectFrom('model_pending_clues').selectAll().where('provider', '=', 'moonshot').execute()
      expect(clues).toEqual([])
      await db.destroy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('目录零条目 = 上游改版:角色标陈旧不留快照,与发布源同契约;退役零条目健康', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-13T00:00:00Z'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { db } = openDb(':memory:')
      const svc = new ModelTrackingService(db, moonshotDeps('<html><body><main>改版后无结构化条目</main></body></html>'))
      await svc.init()
      await svc.pollProvider('moonshot')
      const catalog = await db.selectFrom('model_fetch_status').selectAll()
        .where('provider', '=', 'moonshot').where('role', '=', 'catalog').executeTakeFirstOrThrow()
      expect(catalog).toMatchObject({ stale: 1, pages: null })
      const retirement = await db.selectFrom('model_fetch_status').selectAll()
        .where('provider', '=', 'moonshot').where('role', '=', 'retirement').executeTakeFirstOrThrow()
      expect(retirement).toMatchObject({ stale: 0 }) // 退役零条目合法(当期无公告)
      expect(errSpy.mock.calls.some((c) => c.some((a) => String(a).includes('目录源无结构化条目')))).toBe(true)
      await db.destroy()
    } finally {
      errSpy.mockRestore()
      vi.useRealTimers()
    }
  })

  it('智谱端到端(alias 半边):目录差集走展示名 alias;发布流「停用」公告产退役线索', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-13T00:00:00Z'))
    try {
      const { db } = openDb(':memory:')
      const releasesMd = [
        '# 模型与产品发布记录',
        '',
        '<Update label="2026-09-10" description="GLM-5.3 旗舰能力升级">[GLM-5.3](https://docs.bigmodel.cn/cn/guide/models/text/glm-5.3)</Update>',
        '<Update label="2026-09-09" description="GLM-4.7 停用公告">[GLM-4.7](https://docs.bigmodel.cn/cn/guide/models/text/glm-4.7)</Update>',
      ].join('\n')
      const overviewMd = [
        '| 模型 | 特点 |',
        '| :-- | :-- |',
        '| [GLM-5.3](/cn/guide/models/text/glm-5.3) | 旗舰模型 |',
        '| [Vidu Q1](/cn/guide/models/video-generation/viduq1) | 视频生成 |',
      ].join('\n')
      const svc = new ModelTrackingService(db, {
        env: {},
        fetchText: async (url) => {
          if (url === ZHIPU_OVERVIEW_URL) return overviewMd
          if (url === 'https://docs.bigmodel.cn/cn/update/new-releases.md') return releasesMd
          throw new Error('HTTP 404')
        },
      })
      await svc.init()
      await svc.pollProvider('zhipu')
      const clues = await db.selectFrom('model_pending_clues').selectAll().where('provider', '=', 'zhipu').execute()
      const byKey = new Map(clues.map((c) => [c.model_key, c]))
      // 目录差集(alias 半边):Vidu Q1 展示名不在 alias 集 → 线索;GLM-5.3 精确归并
      expect(byKey.get('Vidu Q1')).toMatchObject({ occurred_on: '2026-09-13', source_url: ZHIPU_OVERVIEW_URL, title: 'Vidu Q1:官方目录在册' })
      // 发布流「停用」公告:既有模型 GLM-4.7 命中 alias → 退役线索(同页发布流残余线索照常,docUrl 键)
      expect(byKey.get('GLM-4.7')).toMatchObject({ occurred_on: '2026-09-09', title: 'GLM-4.7 停用公告' })
      // 双条件命中的 GLM-5.3 升级块产事件不产线索
      expect(byKey.has('GLM-5.3')).toBe(false)
      await db.destroy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('七家六类登记齐全:目录全部条目级;退役六家条目级、通义批次页维持指纹', () => {
    for (const def of Object.values(PROVIDERS)) {
      for (const role of ['release', 'catalog', 'retirement', 'pricing', 'limits', 'weights'] as const) {
        expect(def.sources[role].urls.length).toBeGreaterThan(0)
      }
      expect(typeof def.sources.catalog.parse).toBe('function')
      for (const role of ['pricing', 'limits', 'weights'] as const) {
        expect(def.sources[role].parse).toBe('fingerprint')
      }
    }
    // 通义下线页只有批次日期 + 公告链接、无逐模型 ID(notice 子页客户端渲染拿不到):
    // 退役维持指纹形态,批次页变化经 shadow_rechecks 触发该家全量重核
    for (const [id, def] of Object.entries(PROVIDERS)) {
      expect(typeof def.sources.retirement.parse).toBe(id === 'alibaba' ? 'string' : 'function')
    }
  })
})
