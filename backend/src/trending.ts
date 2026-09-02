import * as cheerio from 'cheerio'
import { schedule } from 'node-cron'
import { Hono } from 'hono'
import type { Context } from 'hono'
import {
  TRENDING_LANGUAGES,
  TRENDING_SPOKEN,
  type TrendingRepo,
  type TrendingResponse,
  type TrendingSince,
} from 'chrome-tab-shared'
import type { AuthEnv } from './auth'
import { makeBatchTranslator, makeTranslationStore, type BatchTranslator, type TranslationStore } from './translate'
import type { Db } from './db'
import { BadRequest, cachedOrNull, type CachedSource, FETCH_TIMEOUT, chromeHeaders, fetchText, jsonBody } from './common'

/**
 * 「GitHub 趋势」(CONTEXT.md「GitHub 趋势」;ADR-0028):独立单例图标的数据服务。
 * GitHub Trending 无官方 API——trending 页 HTML 解析(选择器锚点 2026-08-26 实抓
 * 核验);筛选组合(spoken × language × since)是笛卡尔积,不可全预取:
 * - 默认组合(今日 + 不限)由 cron 1h 保热,图标卡片读缓存零等待;
 * - 其余组合 GET 时现抓,后端内存缓存 TTL 1h,不落库(低频探察,不值得建表)。
 * 抓取失败降级:有过期缓存则照发(fetchedAt 如实陈旧),无缓存才 500。
 * 描述译制(ADR-0030/0036):描述后台批量译成中文(已是简体中文的由 prompt 约束
 * 原样回显)、按描述哈希落 trending_translations 终身复用——榜单不落库,译文是
 * 「原文→中文」永久事实。
 */

/** 内存缓存 TTL;与 cron 保热节奏(1h)同量级。 */
const CACHE_TTL_MS = 60 * 60_000

/** 筛选组合(空串 = 不限,与 GitHub 原生参数缺省一致)。 */
export type TrendingQuery = { since: TrendingSince; language: string; spoken: string }

const SINCE_SET = new Set<string>(['daily', 'weekly', 'monthly'])
const LANG_SET = new Set(TRENDING_LANGUAGES.map((l) => l.slug))
const SPOKEN_SET = new Set(TRENDING_SPOKEN.map((l) => l.slug))

const queryKey = (q: TrendingQuery) => `${q.since}|${q.language}|${q.spoken}`
// 反解(cachedOrNull 的 fetch 回调以序列化键调用;三段值均不含 `|`,split 安全)
const queryFromKey = (key: string): TrendingQuery => {
  const [since, language, spoken] = key.split('|')
  return { since: since as TrendingSince, language, spoken }
}
const starNumber = (s: string): number => Number(s.replace(/,/g, '')) || 0

/** 描述译制系统提示(对齐 news prompt 口径,域语境换为项目描述)。 */
const TRENDING_SYSTEM_PROMPT = `你是专业技术编辑。把用户给出的编号项目描述列表逐条处理,输出同样编号的中文列表。
严格约束：
1. 输出与输入逐条对应：每行「序号. 译文」,不添加任何解释、前后缀,也不要代码围栏。
2. 专有名词、产品名、公司名、代码标识符、库名、API 名保留英文原样。
3. emoji、数字、定价词（$5、free 等）、命令与代码片段原样保留。
4. 译文简洁贴近原文长度,不扩写不解释。
5. 已是简体中文的条目原样输出该条；英中混杂的条目整体译成连贯中文（不保留未译的英文句子）。`

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
  /** 读组合取数源:TTL 1h / 失败回落过期缓存 / 从未成功 null 三不变量走
   *  cachedOrNull 原语(ADR-0042);键 = `since|language|spoken` 序列化,fetch 反解。 */
  private readonly source: CachedSource<string, Entry>

  /** 描述译文仓(ADR-0034):原文键 load/ensure,哈希派生与补译骨架收进 store。 */
  private readonly translations: TranslationStore

  constructor(private readonly db: Db, private readonly deps: TrendingDeps) {
    this.translations = makeTranslationStore(db, 'trending_translations')
    // mimosa-ignore 取数 host 钉死 github.com,用户筛选仅进 query string,无任意出站
    this.source = cachedOrNull<string, Entry>({
      ttlMs: CACHE_TTL_MS,
      // 「新抓成功」钩子写在 fetch 回调内(原语不设 onSuccess——手动补一轮的调用方
      // 会被钩子双发 fire-and-forget):新抓即后台补译(ADR-0030),首批响应先回
      // 原文,译文就位后靠前端既有刷新节奏(staleTime 5min + 聚焦重拉)自然到达。
      fetch: async (key) => {
        const entry: Entry = { repos: await fetchTrending(this.deps, queryFromKey(key)), fetchedAt: Date.now() }
        void this.translateMissingDescriptions(entry.repos)
        return entry
      },
      // 失败不在此打日志:读路径的 500 与 cron catch 已各记一次,原语再 warn 是三重噪音
    })
  }

  /** 组合取数(peek/get + 从未成功上抛原始因),get 与手动补译轮共用。 */
  private async requireEntry(key: string): Promise<Entry> {
    const entry = await this.source.get(key)
    if (entry === null) throw this.source.lastError(key) ?? new Error('趋势榜取数失败(上游不可达且无缓存)')
    return entry
  }

  /** 读组合:TTL/宁旧勿空由原语持有;从未成功 → 域选上抛(诚实 500)。回落路径
   *  fetchedAt 如实陈旧(tile 鲜度位如实显示)。 */
  async get(q: TrendingQuery): Promise<TrendingResponse> {
    return await this.toResponse(await this.requireEntry(queryKey(q)))
  }

  /** cron 保热默认组合(图标卡片视图);失败保留旧缓存由原语降级。 */
  async refreshDefault(): Promise<void> {
    await this.get({ since: 'daily', language: '', spoken: '' })
  }

  /** 手动重试译制(ADR-0030 补译的显式入口,前端「重试翻译」钮):取组合最新榜
   *  (新鲜缓存即用,否则现抓并落缓存),强制补一轮缺失描述。与抓取自动轮不双发:
   *  新鲜缓存命中时 fetch 未跑(无自动轮)才显式补;现抓时 fetch 回调内的自动轮已
   *  在途,不再叠一轮——ensure 无 in-flight 守卫,两轮并发会对同一批缺口双倍送译。
   *  过期 + 上游失败不吞:回落旧榜补译没有意义,上抛让前端显「重试发送失败」。
   *  端点侧 fire-and-forget(LLM 批译最坏跨分钟,同步等待必撞 HTTP 超时),译文到库
   *  由前端 15s 到达轮询收果。 */
  async retryTranslations(q: TrendingQuery): Promise<void> {
    const key = queryKey(q)
    const fresh = this.source.peek(key)
    const entry = await this.requireEntry(key)
    if (fresh === undefined) {
      // 缓存过期:requireEntry 拿到的必须是新抓(fetchedAt 已是当下);仍是旧值 = 上游失败回落,诚实上抛
      if (Date.now() - entry.fetchedAt > 5_000) throw this.source.lastError(key) ?? new Error('趋势榜取数失败(回落旧榜,拒绝补译)')
      return // 现抓已在 fetch 回调内触发自动补译轮
    }
    if (fresh === entry) void this.translateMissingDescriptions(entry.repos) // 新鲜命中:无自动轮,显式补
  }

  /** 描述译文拼装(读侧内存 join,同 news feed 范式;25 哈希一次 in 查询,毫秒级)。 */
  private async toResponse(e: Entry): Promise<TrendingResponse> {
    const descriptions = e.repos.map((r) => r.description).filter((d): d is string => d != null)
    const zh =
      descriptions.length > 0 ? await this.translations.load(descriptions) : new Map<string, string>()
    return {
      repos: e.repos.map((r) => ({
        ...r,
        descriptionZh: r.description ? (zh.get(r.description) ?? null) : null,
      })),
      fetchedAt: new Date(e.fetchedAt).toISOString(),
    }
  }

  /** 描述补译(ADR-0029 新闻范式移植;ADR-0036 起全量送译,已是中文的原样回显由
   *  prompt 约束裁决——混排条目曾因汉字启发式整条跳过而 UI 观感「未翻译」)→ 译文仓
   *  ensure 收编骨架(去重/滤缺/批译/onConflict,ADR-0034)。整体 try 吞错:译制
   *  失败不冒泡进 get——那里会误伤正常取数路径。失败哈希未写,下次该组合缓存过期
   *  重抓(或 cron 1h)自然重试。 */
  private async translateMissingDescriptions(repos: TrendingRepo[]): Promise<void> {
    try {
      const descriptions = repos.map((r) => r.description).filter((d): d is string => d != null)
      if (descriptions.length === 0) return
      await this.translations.ensure(descriptions, this.deps.translateDescriptions, () => true)
    } catch (e) {
      console.warn('趋势描述译制失败,保持原文:', e)
    }
  }
  // ---- 已了解标记(CONTEXT.md「已了解」):账号级项目持久勾,与榜单缓存生命周期无关 ----

  /** 全量已了解 repo(集合语义,字典序仅 wire 稳定用;年千级行,全量直发)。 */
  async knownMarks(userId: number): Promise<string[]> {
    const rows = await this.db
      .selectFrom('trending_known_marks')
      .select('repo')
      .where('user_id', '=', userId)
      .orderBy('repo')
      .execute()
    return rows.map((r) => r.repo)
  }

  /** 标记已了解;重复标记唯一约束吞掉(幂等,不双行)。 */
  async markKnown(userId: number, repo: string): Promise<void> {
    await this.db
      .insertInto('trending_known_marks')
      .values({ user_id: userId, repo, created_at: new Date().toISOString() })
      .onConflict((oc) => oc.doNothing())
      .execute()
  }

  /** 取消标记;未标记同样成功(幂等)。 */
  async unmarkKnown(userId: number, repo: string): Promise<void> {
    await this.db
      .deleteFrom('trending_known_marks')
      .where('user_id', '=', userId)
      .where('repo', '=', repo)
      .execute()
  }
}

// ---- HTTP 路由 ----

/** repo 字段校验(写入信任边界):owner/name 形态,GitHub 上限 owner≤39、repo≤100。 */
const REPO_RE = /^[\w.-]{1,39}\/[\w.-]{1,100}$/
const reqRepo = (v: unknown): string => {
  const repo = typeof v === 'string' ? v.trim() : ''
  if (!REPO_RE.test(repo)) throw new BadRequest('repo: 必须是 owner/name 形式')
  return repo
}

export function trendingRoutes(service: TrendingService): Hono<AuthEnv> {
  /** 组合参数解析 + 白名单校验(参数直接进抓取 URL,拒绝任意值;GET/POST 共用)。 */
  const parseQuery = (c: { req: { query: (k: string) => string | undefined } }): TrendingQuery => {
    const since = c.req.query('since') ?? 'daily'
    const language = c.req.query('language') ?? ''
    const spoken = c.req.query('spoken') ?? ''
    if (!SINCE_SET.has(since)) throw new BadRequest('since: 非法的时间范围')
    if (language && !LANG_SET.has(language)) throw new BadRequest('language: 未收录的语言')
    if (spoken && !SPOKEN_SET.has(spoken)) throw new BadRequest('spoken: 未收录的口语语言')
    return { since: since as TrendingSince, language, spoken }
  }
  const userId = (c: Context<AuthEnv>) => c.get('user')!.id
  return new Hono<AuthEnv>()
    .get('/api/trending', async (c) => c.json(await service.get(parseQuery(c))))
    // mimosa-ignore 同上:补译取数 host 钉死,parseQuery 结果仅进 query string
    .post('/api/trending/retry-translation', (c) => service.retryTranslations(parseQuery(c)).then(() => c.json({ started: true })))
    // 已了解标记(CONTEXT.md「已了解」):三端点响应均 = 写后全量(响应即数据,
    // 前端 onSuccess 权威写,同「新闻源」勾选范式;DELETE 以 ?repo= 传值免 DELETE body)
    .get('/api/trending/marks', async (c) => c.json(await service.knownMarks(userId(c))))
    .put('/api/trending/marks', async (c) => {
      const repo = reqRepo(((await jsonBody(c)) as { repo?: unknown } | null)?.repo)
      await service.markKnown(userId(c), repo)
      return c.json(await service.knownMarks(userId(c)))
    })
    .delete('/api/trending/marks', async (c) => {
      const repo = reqRepo(c.req.query('repo'))
      await service.unmarkKnown(userId(c), repo)
      return c.json(await service.knownMarks(userId(c)))
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
