import { afterEach, describe, expect, it, vi } from 'vitest'
import { openDb } from './db'
import { TrendingService, parseTrending, type TrendingDeps } from './trending'

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

const page = (...articles: string[]) =>
  `<main><div class="Box"><div data-hpc="">${articles.join('')}</div></div></main>`

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

describe('TrendingService 描述译制(ADR-0030)', () => {
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

  it('英文描述后台补译:首批先回原文,落表后缓存命中路径 join 出译文;中文描述不送译', async () => {
    const { deps, translationCalls } = makeDeps(page(ARTICLE_FULL, ARTICLE_EN))
    const db = freshDb()
    const svc = new TrendingService(db, deps)
    const first = await svc.get({ since: 'daily', language: '', spoken: '' })
    // 汉字启发式:中文条 descriptionZh null 且不进译制集;英文条首批未及译文(null)
    expect(first.repos.map((r) => [r.description, r.descriptionZh])).toEqual([
      ['一个描述', null],
      ['A fast build tool', null],
    ])
    expect(translationCalls).toEqual([['A fast build tool']])
    await until(async () => (await zhRows(db)) > 0)
    const second = await svc.get({ since: 'daily', language: '', spoken: '' })
    expect(second.repos[1]!.descriptionZh).toBe('译(A fast build tool)')
    expect(second.repos[0]!.descriptionZh).toBeNull()
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
})
