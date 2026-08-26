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
import { sha256 } from './changelog'
import type { Db } from './db'
import { BadRequest, FETCH_TIMEOUT, chromeHeaders, fetchText } from './common'
import { makeBatchTranslator, type BatchTranslator } from './translate'

/**
 * 「GitHub 趋势」(CONTEXT.md「GitHub 趋势」;ADR-0028):独立单例图标的数据服务。
 * GitHub Trending 无官方 API——trending 页 HTML 解析(选择器锚点 2026-08-26 实抓
 * 核验);筛选组合(spoken × language × since)是笛卡尔积,不可全预取:
 * - 默认组合(今日 + 不限)由 cron 1h 保热,图标卡片读缓存零等待;
 * - 其余组合 GET 时现抓,后端内存缓存 TTL 1h,不落库(低频探察,不值得建表)。
 * 抓取失败降级:有过期缓存则照发(fetchedAt 如实陈旧),无缓存才 500。
 * 描述译制(ADR-0030):非中文描述(汉字启发式判定)后台批量译成中文、按描述哈希
 * 落 trending_translations 终身复用——榜单不落库,译文是「原文→中文」永久事实。
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
const nowIso = () => new Date().toISOString()

/** 汉字启发式(ADR-0030):描述含汉字 → 视为中文不译(零依赖零成本);无汉字的日文假名/
 *  韩文/西里尔等照送译成中文,正合「非中文都译」。误判形态温和——最坏是含汉字的日文
 *  描述保留原样,而非错译。 */
const HAS_HAN = /[\u4e00-\u9fff]/

/** 描述译制系统提示(对齐 news prompt 口径,域语境换为项目描述)。 */
const TRENDING_SYSTEM_PROMPT = `你是专业技术编辑。把用户给出的编号英文项目描述列表逐条译成简体中文,输出同样编号的中文列表。
严格约束：
1. 输出与输入逐条对应：每行「序号. 译文」,不添加任何解释、前后缀,也不要代码围栏。
2. 专有名词、产品名、公司名、代码标识符、库名、API 名保留英文原样。
3. emoji、数字、定价词（$5、free 等）、命令与代码片段原样保留。
4. 译文简洁贴近原文长度,不扩写不解释。`

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
      // 占位 null:wire 出口恒经 toResponse 覆盖(get 是唯一读路径),解析层不碰译制
      descriptionZh: null,
      language,
      languageColor,
      stars: starNumber($(el).find('a[href$="/stargazers"]').text()),
      periodStars: period ? starNumber(period[1]!) : 0,
    })
  })
  return out
}

/** deps 注入 seam(测试塞假实现,同 NewsDeps 范式)。 */
export interface TrendingDeps {
  fetchText: (url: string, timeoutMs: number, init?: RequestInit) => Promise<string>
  /** 描述批量译制(ADR-0030;机制见 translate.ts,null = 该条保持原文)。 */
  translateDescriptions: BatchTranslator
}

export const prodTrendingDeps = (): TrendingDeps => ({
  fetchText,
  translateDescriptions: makeBatchTranslator(TRENDING_SYSTEM_PROMPT, 'trending-translate'),
})

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

  constructor(private readonly db: Db, private readonly deps: TrendingDeps) {}

  /** 读组合:缓存未过期直接回;过期现抓(失败回落过期缓存)。抓取成功即后台补译
   * (ADR-0030 fire-and-forget)——首批响应先回原文,译文就位后靠前端既有刷新节奏
   * (staleTime 5min + 聚焦重拉)自然到达,缓存命中路径每次 join 译文表即见。 */
  async get(q: TrendingQuery): Promise<TrendingResponse> {
    const key = queryKey(q)
    const hit = this.cache.get(key)
    if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) return this.toResponse(hit)
    try {
      const entry: Entry = { repos: await fetchTrending(this.deps, q), fetchedAt: Date.now() }
      this.cache.set(key, entry)
      void this.translateMissingDescriptions(entry.repos)
      return await this.toResponse(entry)
    } catch (e) {
      // 降级:陈旧数据好过没有(tile 有 fetchedAt 如实显示鲜度);无缓存才上抛 500
      if (hit) return await this.toResponse(hit)
      throw e
    }
  }

  /** cron 保热默认组合(图标卡片视图);失败保留旧缓存由 get 降级。 */
  async refreshDefault(): Promise<void> {
    await this.get({ since: 'daily', language: '', spoken: '' })
  }

  /** 描述译文拼装(读侧内存 join,同 news feed 范式;25 哈希一次 in 查询,毫秒级)。 */
  private async toResponse(e: Entry): Promise<TrendingResponse> {
    const descriptions = e.repos.map((r) => r.description).filter((d): d is string => d != null)
    const zh =
      descriptions.length > 0 ? await this.loadTranslations(descriptions) : new Map<string, string>()
    return {
      repos: e.repos.map((r) => ({
        ...r,
        descriptionZh: r.description ? (zh.get(sha256(r.description)) ?? null) : null,
      })),
      fetchedAt: new Date(e.fetchedAt).toISOString(),
    }
  }

  /** 非中文描述补译(ADR-0029 新闻范式移植):汉字启发式过滤 → 扫缺译 → 批量译 →
   *  写哈希表。整体 try 吞错:译制失败不冒泡进 get——那里会误伤正常取数路径。
   *  失败哈希未写,下次该组合缓存过期重抓(或 cron 1h)自然重试。 */
  private async translateMissingDescriptions(repos: TrendingRepo[]): Promise<void> {
    try {
      const descriptions = [
        ...new Set(
          repos
            .map((r) => r.description)
            .filter((d): d is string => d != null)
            .filter((d) => !HAS_HAN.test(d)),
        ),
      ]
      if (descriptions.length === 0) return
      const known = await this.loadTranslations(descriptions)
      const missing = descriptions.filter((d) => !known.has(sha256(d)))
      if (missing.length === 0) return
      const translated = await this.deps.translateDescriptions(missing)
      const inserts = translated
        .map((t, i) => (t == null ? null : { desc_hash: sha256(missing[i]!), translated: t, created_at: nowIso() }))
        .filter((v): v is { desc_hash: string; translated: string; created_at: string } => v != null)
      if (inserts.length > 0) {
        await this.db
          .insertInto('trending_translations')
          .values(inserts)
          .onConflict((oc) => oc.column('desc_hash').doNothing())
          .execute()
      }
    } catch (e) {
      console.warn('趋势描述译制失败,保持原文:', e)
    }
  }

  /** 描述 → 已有译文(哈希键);组合 25 条量级,单次 in 查询即足(无 news 500/批分片需求)。 */
  private async loadTranslations(descriptions: string[]): Promise<Map<string, string>> {
    const rows = await this.db
      .selectFrom('trending_translations')
      .select(['desc_hash', 'translated'])
      .where(
        'desc_hash',
        'in',
        [...new Set(descriptions)].map(sha256),
      )
      .execute()
    return new Map(rows.map((r) => [r.desc_hash, r.translated] as const))
  }
}

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
