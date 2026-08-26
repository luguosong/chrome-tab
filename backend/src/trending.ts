import * as cheerio from 'cheerio'
import { schedule } from 'node-cron'
import { Hono } from 'hono'
import {
  TRENDING_LANGUAGES,
  TRENDING_SPOKEN,
  type TrendingRepo,
  type TrendingResponse,
  type TrendingSince,
} from 'chrome-tab-shared'
import type { AuthEnv } from './auth'
import { BadRequest, FETCH_TIMEOUT, chromeHeaders, fetchText } from './common'

/**
 * 「GitHub 趋势」(CONTEXT.md「GitHub 趋势」;ADR-0028):独立单例图标的数据服务。
 * GitHub Trending 无官方 API——trending 页 HTML 解析(选择器锚点 2026-08-26 实抓
 * 核验);筛选组合(spoken × language × since)是笛卡尔积,不可全预取:
 * - 默认组合(今日 + 不限)由 cron 1h 保热,图标卡片读缓存零等待;
 * - 其余组合 GET 时现抓,后端内存缓存 TTL 1h,不落库(低频探察,不值得建表)。
 * 抓取失败降级:有过期缓存则照发(fetchedAt 如实陈旧),无缓存才 500。
 */

/** 内存缓存 TTL;与 cron 保热节奏(1h)同量级。 */
const CACHE_TTL_MS = 60 * 60_000

/** 筛选组合(空串 = 不限,与 GitHub 原生参数缺省一致)。 */
export type TrendingQuery = { since: TrendingSince; language: string; spoken: string }

const SINCE_SET = new Set<string>(['daily', 'weekly', 'monthly'])
const LANG_SET = new Set(TRENDING_LANGUAGES.map((l) => l.slug))
const SPOKEN_SET = new Set(TRENDING_SPOKEN.map((l) => l.slug))

const queryKey = (q: TrendingQuery) => `${q.since}|${q.language}|${q.spoken}`
const starNumber = (s: string): number => Number(s.replace(/,/g, '')) || 0

/** 解析 trending 页 HTML(纯函数,fixture 见 trending.test.ts)。 */
export function parseTrending(html: string): TrendingRepo[] {
  const $ = cheerio.load(html)
  const out: TrendingRepo[] = []
  $('article.Box-row').each((_, el) => {
    const href = $(el).find('h2 a').first().attr('href')
    if (!href?.startsWith('/')) return
    const description = $(el).find('p').first().text().replace(/\s+/g, ' ').trim() || null
    const language = $(el).find('[itemprop="programmingLanguage"]').text().trim() || null
    const languageColor =
      $(el).find('.repo-language-color').attr('style')?.match(/#[0-9a-fA-F]{3,8}/)?.[0] ?? null
    // 周期增量锚定自身 span(2026-08-26 实抓核验),与 stargazers 数字物理隔离——
    // 整块 text() 上跑正则会把紧邻的总 star 数字拼接进来(测试实抓 fixture 抓获)
    const period = $(el)
      .find('span.float-sm-right')
      .text()
      .match(/([\d,]+)\s+stars\s+(?:today|this week|this month)/)
    out.push({
      repo: href.replace(/^\//, ''),
      url: `https://github.com${href}`,
      description,
      language,
      languageColor,
      stars: starNumber($(el).find('a[href$="/stargazers"]').text()),
      periodStars: period ? starNumber(period[1]!) : 0,
    })
  })
  return out
}

/** deps 注入 seam(测试塞假实现,同 NewsDeps 范式;trending 只需文本抓取)。 */
export interface TrendingDeps {
  fetchText: (url: string, timeoutMs: number, init?: RequestInit) => Promise<string>
}

export const prodTrendingDeps = (): TrendingDeps => ({ fetchText })

async function fetchTrending(deps: TrendingDeps, q: TrendingQuery): Promise<TrendingRepo[]> {
  const params = new URLSearchParams()
  if (q.since !== 'daily') params.set('since', q.since)
  if (q.language) params.set('language', q.language)
  if (q.spoken) params.set('spoken_language_code', q.spoken)
  const qs = params.toString()
  const html = await deps.fetchText(
    `https://github.com/trending${qs ? `?${qs}` : ''}`,
    FETCH_TIMEOUT,
    chromeHeaders(),
  )
  // 空结果视为失败(上游改版/风控墙常见形态,同 news 口径)——不写缓存保住旧数据
  const repos = parseTrending(html)
  if (repos.length === 0) throw new Error('trending 页解析得 0 条(疑似改版或风控拦截)')
  return repos
}

type Entry = { repos: TrendingRepo[]; fetchedAt: number }

export class TrendingService {
  private readonly cache = new Map<string, Entry>()

  constructor(private readonly deps: TrendingDeps) {}

  /** 读组合:缓存未过期直接回;过期现抓(失败回落过期缓存)。 */
  async get(q: TrendingQuery): Promise<TrendingResponse> {
    const key = queryKey(q)
    const hit = this.cache.get(key)
    if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) return toResponse(hit)
    try {
      const entry: Entry = { repos: await fetchTrending(this.deps, q), fetchedAt: Date.now() }
      this.cache.set(key, entry)
      return toResponse(entry)
    } catch (e) {
      // 降级:陈旧数据好过没有(tile 有 fetchedAt 如实显示鲜度);无缓存才上抛 500
      if (hit) return toResponse(hit)
      throw e
    }
  }

  /** cron 保热默认组合(图标卡片视图);失败保留旧缓存由 get 降级。 */
  async refreshDefault(): Promise<void> {
    await this.get({ since: 'daily', language: '', spoken: '' })
  }
}

const toResponse = (e: Entry): TrendingResponse => ({
  repos: e.repos,
  fetchedAt: new Date(e.fetchedAt).toISOString(),
})

// ---- HTTP 路由 ----

export function trendingRoutes(service: TrendingService): Hono<AuthEnv> {
  return new Hono<AuthEnv>().get('/api/trending', async (c) => {
    const since = c.req.query('since') ?? 'daily'
    const language = c.req.query('language') ?? ''
    const spoken = c.req.query('spoken') ?? ''
    // 白名单校验:参数直接进抓取 URL,拒绝任意值(精选词表即有效集)
    if (!SINCE_SET.has(since)) throw new BadRequest('since: 非法的时间范围')
    if (language && !LANG_SET.has(language)) throw new BadRequest('language: 未收录的语言')
    if (spoken && !SPOKEN_SET.has(spoken)) throw new BadRequest('spoken: 未收录的口语语言')
    return c.json(await service.get({ since: since as TrendingSince, language, spoken }))
  })
}

// ---- 调度 ----

/** 1h 一轮保热默认组合(53 分错开整点与既有调度器);启动即预热,重启后首开页也零等待。 */
export function startTrendingScheduler(service: TrendingService): void {
  void service.refreshDefault().catch((e) => console.error('trending 启动预热失败:', e))
  schedule('53 * * * *', () =>
    service.refreshDefault().catch((e) => console.error('trending 保热取数失败:', e)),
  )
}
