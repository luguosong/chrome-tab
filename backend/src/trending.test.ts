import { afterEach, describe, expect, it, vi } from 'vitest'
import { openDb } from './db'
import { TrendingService, parseTrending, trendingRoutes, type TrendingDeps } from './trending'

/** 解析层 fixture 测试(锚点 2026-08-26 实抓 github.com/trending 核验;class 精简保留语义)。 */

const ARTICLE_FULL =
  '<article class="Box-row">' +
  '<h2 class="h3 lh-condensed"><a href="/foo/bar">foo / bar</a></h2>' +
  '<p class="col-9 color-fg-muted my-1 tmp-pr-4">一个描述</p>' +
  '<div class="f6 color-fg-muted mt-2">' +
  '<span><span class="repo-language-color" style="background-color: #f1e05a"></span>' +
  '<span itemprop="programmingLanguage">JavaScript</span></span>' +
  '<a href="/foo/bar/stargazers"><svg></svg>19,349</a>' +
  '</div>' +
  '<span class="d-inline-block float-sm-right">1,698 stars today</span>' +
  '</article>'

const ARTICLE_MINIMAL =
  '<article class="Box-row">' +
  '<h2><a href="/baz/qux">baz / qux</a></h2>' +
  '<a href="/baz/qux/stargazers">12</a>' +
  '<span class="d-inline-block float-sm-right">3 stars this week</span>' +
  '</article>'

/** 英文描述条目(译制链 fixture;ADR-0030)。 */
const ARTICLE_EN =
  '<article class="Box-row">' +
  '<h2><a href="/en/repo">en / repo</a></h2>' +
  '<p>A fast build tool</p>' +
  '<span class="d-inline-block float-sm-right">5 stars today</span>' +
  '</article>'

/** 混排描述条目(2026-08-27 线上周榜实抓形态:awesome-gpt-image-2,英文开头+汉字主体;
 *  曾被汉字启发式整条跳过致 UI 观感「未翻译」,ADR-0036 的引子)。 */
const ARTICLE_MIXED =
  '<article class="Box-row">' +
  '<h2><a href="/mix/repo">mix / repo</a></h2>' +
  '<p>Prompt as Code 工业级提示词引擎与模板库</p>' +
  '<span class="d-inline-block float-sm-right">7 stars this week</span>' +
  '</article>'

const page = (...articles: string[]) =>
  `<main><div class="Box"><div data-hpc="">${articles.join('')}</div></div></main>`

describe('trendingRoutes(HTTP wire)', () => {
  it('GET /api/trending 返回完整 response(repos/fetchedAt 在场)——c.json 不吃 Promise', async () => {
    // 2026-08-27 线上事故:c.json(service.get(...)) 把 Promise 同步序列化成 {},
    // 前端 data.repos 裸调 .some 崩整页。router 层从此处锁 wire 形状。
    const deps: TrendingDeps = {
      fetchText: async () => page(ARTICLE_EN),
      translateDescriptions: async (texts) => texts.map((t) => `译(${t})`),
    }
    const app = trendingRoutes(new TrendingService(openDb(':memory:').db, deps))
    const res = await app.request('/api/trending')
    const body = (await res.json()) as { repos?: { repo: string }[]; fetchedAt?: string }
    expect(Array.isArray(body.repos)).toBe(true)
    expect(body.repos?.[0]).toMatchObject({ repo: 'en/repo' })
    expect(typeof body.fetchedAt).toBe('string')
  })

  it('POST retry-translation 未带组合参数时走默认 daily 形状并立即应答 started', async () => {
    const deps: TrendingDeps = {
      fetchText: async () => page(ARTICLE_EN),
      translateDescriptions: async (texts) => texts.map((t) => `译(${t})`),
    }
    const app = trendingRoutes(new TrendingService(openDb(':memory:').db, deps))
    const res = await app.request('/api/trending/retry-translation', { method: 'POST' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ started: true })
  })

  it('参数白名单:非法 since 拒绝且不出站抓取(BadRequest→400 由 app.ts 全局 onError 转换)', async () => {
    let fetched = false
    const deps: TrendingDeps = {
      fetchText: async () => {
        fetched = true
        return page(ARTICLE_EN)
      },
      translateDescriptions: async (texts) => texts.map((t) => `译(${t})`),
    }
    const app = trendingRoutes(new TrendingService(openDb(':memory:').db, deps))
    // 裸子 app 无全局 onError,BadRequest 兜底 500;锁的行为是「拒绝 + 零出站」
    expect((await app.request('/api/trending?since=yearly')).status).toBeGreaterThanOrEqual(400)
    expect(
      (await app.request('/api/trending/retry-translation?since=yearly', { method: 'POST' })).status,
    ).toBeGreaterThanOrEqual(400)
    expect(fetched).toBe(false)
  })
})

describe('parseTrending', () => {
  it('全字段:repo/url/描述/语言/色/总 star/周期增量', () => {
    const repos = parseTrending(page(ARTICLE_FULL))
    expect(repos).toEqual([
      {
        repo: 'foo/bar',
        url: 'https://github.com/foo/bar',
        description: '一个描述',
        descriptionZh: null,
        language: 'JavaScript',
        languageColor: '#f1e05a',
        stars: 19349,
        periodStars: 1698,
      },
    ])
  })

  it('缺描述/缺语言条目:字段回落 null,周期词态随 since 变体', () => {
    const repos = parseTrending(page(ARTICLE_MINIMAL))
    expect(repos).toEqual([
      {
        repo: 'baz/qux',
        url: 'https://github.com/baz/qux',
        description: null,
        descriptionZh: null,
        language: null,
        languageColor: null,
        stars: 12,
        periodStars: 3,
      },
    ])
  })

  it('改版/风控页解析 0 条(fetchTrending 据此判失败,不写缓存)', () => {
    expect(parseTrending('<html><body>login wall</body></html>')).toEqual([])
  })
})

describe('TrendingService 缓存', () => {
  afterEach(() => vi.useRealTimers())

  const repos = parseTrending(page(ARTICLE_FULL))
  const makeDeps = () => {
    const calls: string[] = []
    const deps: TrendingDeps = {
      fetchText: async (url) => {
        calls.push(url)
        return page(ARTICLE_FULL)
      },
      translateDescriptions: async () => [],
    }
    return { deps, calls }
  }
  const freshDb = () => openDb(':memory:').db

  it('TTL 内重复读不重复抓(默认组合命中 cron 保热缓存)', async () => {
    const { deps, calls } = makeDeps()
    const svc = new TrendingService(freshDb(), deps)
    const q = { since: 'daily', language: '', spoken: '' } as const
    await svc.get(q)
    const again = await svc.get(q)
    expect(calls).toHaveLength(1)
    expect(again.repos).toEqual(repos)
  })

  it('组合不同 key 不同(筛选维度进抓取 URL)', async () => {
    const { deps, calls } = makeDeps()
    const svc = new TrendingService(freshDb(), deps)
    await svc.get({ since: 'weekly', language: 'python', spoken: 'zh' })
    expect(calls[0]).toBe('https://github.com/trending?since=weekly&language=python&spoken_language_code=zh')
  })

  it('过期后现抓失败回落旧缓存(fetchedAt 如实陈旧),无缓存才上抛', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-26T08:00:00Z'))
    const { deps, calls } = makeDeps()
    const svc = new TrendingService(freshDb(), deps)
    const q = { since: 'daily', language: '', spoken: '' } as const
    const first = await svc.get(q)
    expect(first.fetchedAt).toBe('2026-08-26T08:00:00.000Z')
    // 1h+ 后 TTL 过期;deps 换成恒失败
    vi.setSystemTime(new Date('2026-08-26T09:30:00Z'))
    deps.fetchText = async () => {
      throw new Error('风控')
    }
    const stale = await svc.get(q)
    expect(stale.repos).toEqual(repos)
    expect(stale.fetchedAt).toBe('2026-08-26T08:00:00.000Z')
    // 无缓存组合:失败上抛(路由 500,前端重试)
    await expect(svc.get({ since: 'monthly', language: '', spoken: '' })).rejects.toThrow('风控')
    expect(calls).toHaveLength(1)
  })
})

describe('TrendingService 描述译制(ADR-0030/0036)', () => {
  /** fire-and-forget 补译落表的小轮询(真实 timer,本 describe 无 fake timers)。 */
  const until = async (cond: () => boolean | Promise<boolean>) => {
    for (let i = 0; i < 200 && !(await cond()); i++) await new Promise((r) => setTimeout(r, 5))
    expect(await cond()).toBe(true)
  }

  const makeDeps = (html: string) => {
    const translationCalls: string[][] = []
    const deps: TrendingDeps = {
      fetchText: async () => html,
      translateDescriptions: async (texts) => {
        translationCalls.push(texts)
        return texts.map((t) => `译(${t})`)
      },
    }
    return { deps, translationCalls }
  }
  const freshDb = () => openDb(':memory:').db
  const zhRows = async (db: ReturnType<typeof freshDb>) =>
    (await db.selectFrom('trending_translations').selectAll().execute()).length

  it('英/中/混排描述全量送译(混排条是否译文由 prompt 约束 LLM 裁决):首批先回原文,落表后 join 出译文', async () => {
    const { deps, translationCalls } = makeDeps(page(ARTICLE_MIXED, ARTICLE_EN))
    const db = freshDb()
    const svc = new TrendingService(db, deps)
    const first = await svc.get({ since: 'daily', language: '', spoken: '' })
    // 全量送译:不再有「含汉字即跳过」(0036 修订);首批 fire-and-forget 未及译文(恒 null)
    expect(first.repos.map((r) => [r.description, r.descriptionZh])).toEqual([
      ['Prompt as Code 工业级提示词引擎与模板库', null],
      ['A fast build tool', null],
    ])
    // 首批全量送译(fire-and-forget 补译的记录点在微任务链上,until 轮询去竞态)
    await until(() => translationCalls.length > 0)
    expect(translationCalls).toEqual([['Prompt as Code 工业级提示词引擎与模板库', 'A fast build tool']])
    await until(async () => (await zhRows(db)) > 0)
    const second = await svc.get({ since: 'daily', language: '', spoken: '' })
    expect(second.repos.map((r) => r.descriptionZh)).toEqual([
      '译(Prompt as Code 工业级提示词引擎与模板库)',
      '译(A fast build tool)',
    ])
  })

  it('同描述跨组合哈希复用,不重译', async () => {
    const { deps, translationCalls } = makeDeps(page(ARTICLE_EN))
    const db = freshDb()
    const svc = new TrendingService(db, deps)
    await svc.get({ since: 'daily', language: '', spoken: '' })
    await until(async () => (await zhRows(db)) > 0)
    await svc.get({ since: 'weekly', language: '', spoken: '' })
    expect(translationCalls).toHaveLength(1)
  })

  it('译制器抛错整体吞掉:get 正常返回原文,不污染取数路径', async () => {
    const deps: TrendingDeps = {
      fetchText: async () => page(ARTICLE_EN),
      translateDescriptions: async () => {
        throw new Error('网关炸了')
      },
    }
    const svc = new TrendingService(freshDb(), deps)
    const res = await svc.get({ since: 'daily', language: '', spoken: '' })
    expect(res.repos[0]!.description).toBe('A fast build tool')
    expect(res.repos[0]!.descriptionZh).toBeNull()
  })

  it('手动重试(ADR-0036 显式入口):缓存内直接补译缺行;幂等——已入库行不再进批', async () => {
    let failTranslation = true
    const attempts: ('fail' | 'ok')[] = [] // 批译台账:fail 也会记(先记后抛),供轮询确认
    const db = freshDb()
    const svc = new TrendingService(db, {
      fetchText: async () => page(ARTICLE_EN),
      translateDescriptions: async (texts) => {
        if (failTranslation) {
          attempts.push('fail')
          throw new Error('网关挂了')
        }
        attempts.push('ok')
        return texts.map((t) => `译(${t})`)
      },
    })
    const q = { since: 'daily', language: '', spoken: '' } as const
    await svc.get(q)
    await until(async () => attempts.includes('fail')) // 首轮自动补译已发起且被吞
    expect(await zhRows(db)).toBe(0)

    failTranslation = false
    await svc.retryTranslations(q) // 显式补译:立即 resolve(fire-and-forget),落表异步
    await until(async () => attempts.includes('ok') && (await zhRows(db)) > 0)
    expect((await svc.get(q)).repos[0]!.descriptionZh).toBe('译(A fast build tool)')
    await svc.retryTranslations(q) // 已入库后重复重试:ensure load 先滤掉,零新批
    expect(attempts.filter((a) => a === 'ok')).toHaveLength(1)
  })
})
