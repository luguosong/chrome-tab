import { createHash } from 'node:crypto'
import { schedule } from 'node-cron'
import { Hono, type Context } from 'hono'
import { XMLParser } from 'fast-xml-parser'
import type { VideoBlogger, VideoCategory, VideoFeedItem } from 'chrome-tab-shared'
import { TtlCache } from './common'
import type { Db } from './db'
import type { AuthEnv } from './auth'
import { BadRequest, ConflictError, numericParam } from './common'

/**
 * 视频更新(博主投稿跟踪,CONTEXT.md「视频更新/博主/分类」;ADR-0023/0024)。
 * 数据全落 SQLite,后端 1h 定时轮询预取、前端只读——与「AI 热点」的易失代理相反。
 * 取数路线:YouTube「RSS 轮询(0 配额变更检测)+ Data API 按需(首添补 50 历史、
 * 新视频补时长)」;B站「登录 Cookie 直打 wbi 接口(游客态实测连发即风控,已判死)」。
 * 降级:两凭据均可缺——无 key 的 YouTube 博主 RSS 15 条缺时长头像(存量不回补),
 * 无 Cookie 的 B站博主逐轮失败、连续 24 轮标 failing 不删(凭据补齐下轮自愈)。
 * 调度:模块自有 promise 尾链(首添投递与 cron 全量轮询串行,B站 UP 间 5–15s 错峰),
 * 不与更新日志译制通道复用——资源面(LLM 网关 vs 双平台 HTTP)与节奏(6h vs 1h)都不同。
 */

// ---- 纯函数(解析与签名;模块级 seam,无 IO)----

/** 视频时长 → 秒。两形态:Data API ISO 8601(PT15M33S / P1DT2H)与 B站 length("24:39"、超 1h "1:02:39")。无法解析 → null。 */
export function parseDurationSeconds(input: string): number | null {
  const iso = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(input)
  if (iso) {
    const [, d, h, m, s] = iso
    if (d === undefined && h === undefined && m === undefined && s === undefined) return null // 'P'/'PT' 空壳
    return Number(d ?? 0) * 86_400 + Number(h ?? 0) * 3_600 + Number(m ?? 0) * 60 + Number(s ?? 0)
  }
  const colon = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})$/.exec(input.trim())
  if (colon) {
    const [, h, m, s] = colon
    return Number(h ?? 0) * 3_600 + Number(m ?? 0) * 60 + Number(s)
  }
  return null
}

/** 主页 URL → 平台博主标识。只认 YouTube 频道页四形态与 B站空间页(研究实测口径);watch/video 条目页 → null。 */
export function parseBloggerUrl(
  raw: string,
): { platform: 'youtube'; kind: 'channel' | 'handle' | 'custom' | 'user'; value: string } | {
  platform: 'bilibili'
  kind: 'space'
  value: string
} | null {
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    return null
  }
  const host = u.hostname.replace(/^www\./, '')
  if (host === 'youtube.com' || host === 'm.youtube.com') {
    for (const [kind, re] of [
      ['handle', /^\/@([^/]+)\/?$/],
      ['channel', /^\/channel\/([^/]+)\/?$/],
      ['custom', /^\/c\/([^/]+)\/?$/],
      ['user', /^\/user\/([^/]+)\/?$/],
    ] as const) {
      const m = re.exec(u.pathname)
      if (m) return { platform: 'youtube', kind, value: decodeURIComponent(m[1]!) }
    }
  }
  if (host === 'space.bilibili.com') {
    // 路径数字即 mid,与 uid 同义无需换算;www.bilibili.com/space/ 形态实测 404 不支持
    const m = /^\/(\d+)(?:\/(?:video|upload))?\/?$/.exec(u.pathname)
    if (m) return { platform: 'bilibili', kind: 'space', value: m[1]! }
  }
  return null
}

/** wbi 重排索引表(bilibili-API-collect 镜像快照;上游 key 日更但表多年未变)。 */
const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19,
  29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
]

/** img_key + sub_key(各 32,来自 nav 接口 URL 文件名)按表重排取前 32 = mixin_key。 */
export function mixinKey(imgKey: string, subKey: string): string {
  const raw = imgKey + subKey
  return MIXIN_KEY_ENC_TAB.slice(0, 32)
    .map((i) => raw[i])
    .join('')
}

/** wbi 签名:参数(含 wts)按键名升序、value 过滤 !'()* 后 encode 拼接,w_rid = md5(query + mixin_key)。 */
export function buildWbiQuery(params: Record<string, string>, key: string, wts: number) {
  const merged: Record<string, string> = { ...params, wts: String(wts) }
  const query = Object.keys(merged)
    .sort()
    .map((k) => `${k}=${encodeURIComponent(merged[k]!.replace(/[!'()*]/g, ''))}`)
    .join('&')
  const wRid = createHash('md5').update(query + key, 'utf8').digest('hex')
  return { query, wRid }
}

/** YouTube 官方 RSS 条目(解析后的统一形态,入库前中间结构)。 */
export interface FeedVideo {
  videoId: string
  title: string
  url: string
  thumbnailUrl: string | null
  durationSeconds: number | null
  publishedAt: number
  authorName: string | null
}

const rssXml = new XMLParser({ ignoreAttributes: false })

/** 官方 RSS(Atom 命名空间)→ 条目数组。shorts 的 link 原样保留;实体由解析器解码。空/畸形 → 空数组。 */
export function parseYouTubeRss(xml: string): FeedVideo[] {
  let feed: unknown
  try {
    feed = (rssXml.parse(xml) as { feed?: unknown })?.feed
  } catch {
    return []
  }
  const entries = (feed as { entry?: unknown })?.entry
  if (!entries) return []
  const list = Array.isArray(entries) ? entries : [entries]
  return list
    .map((e) => {
      const rec = e as Record<string, unknown>
      const links = rec['link']
      const linkList = (Array.isArray(links) ? links : links ? [links] : []) as Array<
        Record<string, unknown>
      >
      const alt = linkList.find((l) => l['@_rel'] === 'alternate')?.['@_href']
      const thumb = (rec['media:group'] as Record<string, unknown> | undefined)?.[
        'media:thumbnail'
      ] as Record<string, unknown> | undefined
      const published = typeof rec['published'] === 'string' ? rec['published'] : ''
      return {
        videoId: String(rec['yt:videoId'] ?? ''),
        title: typeof rec['title'] === 'string' ? rec['title'] : '',
        url: typeof alt === 'string' ? alt : '',
        thumbnailUrl: typeof thumb?.['@_url'] === 'string' ? thumb['@_url'] : null,
        durationSeconds: null, // RSS 无任何时长字段(研究实测),有 key 时由 videos.list 补
        publishedAt: published ? Math.floor(Date.parse(published) / 1000) : 0,
        authorName:
          typeof (rec['author'] as Record<string, unknown> | undefined)?.['name'] === 'string'
            ? (rec['author'] as Record<string, string>)['name']
            : null,
      }
    })
    .filter((v) => v.videoId && v.url)
}

/** 频道页 <link rel="canonical">(YouTube 三种非 channel 形态一次性解析 channel_id 用)。 */
export function extractCanonical(html: string): string | null {
  for (const tag of html.matchAll(/<link\b[^>]*>/gi)) {
    if (/rel=["']canonical["']/i.test(tag[0])) {
      const href = /href=["']([^"']+)["']/i.exec(tag[0])?.[1]
      if (href) return href
    }
  }
  return null
}

/** og:title / og:image(无 key 首添 YouTube 博主时的昵称与头像来源)。 */
export function extractOg(html: string): { title: string | null; image: string | null } {
  const pick = (prop: string) => {
    for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
      if (new RegExp(`property=["']${prop}["']`, 'i').test(tag[0])) {
        const content = /content=["']([^"']*)["']/i.exec(tag[0])?.[1]
        if (content) return content
      }
    }
    return null
  }
  return { title: pick('og:title'), image: pick('og:image') }
}

// ---- 服务(取数编排 + 轮询;IO 全部经 VideoDeps 注入)----

/** IO 协作器(测试注入假实现,同 ChangelogDeps 范式)。fetchText:非 2xx 抛错。 */
export interface VideoDeps {
  fetchText: (url: string, timeoutMs: number, init?: RequestInit) => Promise<string>
  /** B站 wbi mixin_key(生产 = nav 接口 + 12h 缓存;测试直供免 mock nav)。 */
  getMixinKey: () => Promise<string>
  /** 轮询错峰 sleep(生产 setTimeout;测试 no-op)。 */
  sleep: (ms: number) => Promise<void>
  youtubeApiKey: string
  bilibiliCookie: string
}

const BILI_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
/** B站缩略图/头像给 http://,https 页面下 mixed-content——入库前统一改写(研究实测 https 直连可用)。 */
const httpsify = (u: string | null) => (u ? u.replace(/^http:\/\//, 'https://') : null)
const nowIso = () => new Date().toISOString()
const nowSec = () => Math.floor(Date.now() / 1000)
/** 每博主滚动保留窗口(spec):入库后同事务裁剪。 */
const KEEP_PER_BLOGGER = 50
/** 连续失败多少轮(1h/轮 = 1 天)标 failing(spec 降级口径)。 */
const FAIL_STREAK_LIMIT = 24

type BloggerRow = {
  id: number
  user_id: number
  platform: string
  platform_user_id: string
  name: string
  avatar_url: string | null
  category_id: number | null
  fail_streak: number
  status: string
}

export class VideoUpdatesService {
  /** 同 ChangelogService.exclusive:cron 全量轮询与首添投递排同一条链串行(B站错峰不被并发破坏)。 */
  private tail: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly db: Db,
    private readonly deps: VideoDeps,
  ) {}

  // —— 读侧(路由直调,不经尾链;库即真相,无内存镜像)——

  async feed(userId: number): Promise<VideoFeedItem[]> {
    const rows = await this.db
      .selectFrom('videos')
      .innerJoin('video_bloggers', 'videos.blogger_id', 'video_bloggers.id')
      .select([
        'videos.id as id',
        'videos.title as title',
        'videos.url as url',
        'videos.thumbnail_url as thumbnailUrl',
        'videos.duration_seconds as durationSeconds',
        'videos.published_at as publishedAt',
        'video_bloggers.id as bloggerId',
        'video_bloggers.name as bloggerName',
        'video_bloggers.platform as platform',
        'video_bloggers.category_id as categoryId',
      ])
      .where('video_bloggers.user_id', '=', userId)
      .orderBy('videos.published_at', 'desc')
      .execute()
    return rows.map((r) => ({
      ...r,
      thumbnailUrl: r.thumbnailUrl ?? null,
      durationSeconds: r.durationSeconds ?? null,
      categoryId: r.categoryId ?? null,
    })) as VideoFeedItem[]
  }

  /** 分类列表(sort_order 序)+ 各分类博主数 + 未分类博主数(前端 tab 显隐与管理用)。 */
  async categories(userId: number) {
    const cats = await this.db
      .selectFrom('video_categories')
      .selectAll()
      .where('user_id', '=', userId)
      .orderBy('sort_order', 'asc')
      .orderBy('id', 'asc')
      .execute()
    const bloggers = await this.db
      .selectFrom('video_bloggers')
      .select(['category_id'])
      .where('user_id', '=', userId)
      .execute()
    const counts = new Map<number, number>()
    let uncategorized = 0
    for (const b of bloggers) {
      if (b.category_id === null) uncategorized++
      else counts.set(b.category_id, (counts.get(b.category_id) ?? 0) + 1)
    }
    return {
      categories: cats.map((c) => ({
        id: c.id,
        name: c.name,
        sortOrder: c.sort_order,
        bloggerCount: counts.get(c.id) ?? 0,
      })),
      uncategorizedCount: uncategorized,
    }
  }

  /** 管理用博主列表(status 供「取数失败」标红)。 */
  async bloggers(userId: number): Promise<VideoBlogger[]> {
    const rows = await this.db
      .selectFrom('video_bloggers')
      .selectAll()
      .where('user_id', '=', userId)
      .orderBy('id', 'asc')
      .execute()
    return rows.map((r) => this.toBloggerWire(r))
  }

  // —— 管理(博主/分类 CRUD;博主元信息同步解析,视频历史异步投尾链)——

  /** 添加:解析 URL → 同步拉博主元信息(数秒)→ 入库(归未分类)→ 投递首取(不阻塞请求)。 */
  async addBlogger(userId: number, url: string): Promise<VideoBlogger> {
    const parsed = parseBloggerUrl(url)
    if (!parsed) throw new BadRequest('请粘贴博主主页链接(YouTube 频道页或 B站空间页)')
    const meta =
      parsed.platform === 'bilibili'
        ? await this.resolveBilibili(parsed.value)
        : await this.resolveYouTube(parsed)
    const exists = await this.db
      .selectFrom('video_bloggers')
      .select('id')
      .where('user_id', '=', userId)
      .where('platform', '=', parsed.platform)
      .where('platform_user_id', '=', meta.channelId)
      .executeTakeFirst()
    if (exists) throw new ConflictError(409, '该博主已添加')
    const row = await this.db
      .insertInto('video_bloggers')
      .values({
        user_id: userId,
        platform: parsed.platform,
        platform_user_id: meta.channelId,
        name: meta.name,
        avatar_url: meta.avatarUrl,
        category_id: null,
        fail_streak: 0,
        status: 'ok',
        created_at: nowIso(),
      })
      .returningAll()
      .executeTakeFirstOrThrow()
    // 首添即时首取:进尾链排队(不待下个整点、不阻塞本请求;失败由轮询口径自愈)
    void this.enqueue(() => this.backfill(row.id))
    return this.toBloggerWire(row)
  }

  async setBloggerCategory(userId: number, bloggerId: number, categoryId: number | null) {
    if (categoryId !== null) {
      const cat = await this.db
        .selectFrom('video_categories')
        .select('id')
        .where('id', '=', categoryId)
        .where('user_id', '=', userId)
        .executeTakeFirst()
      if (!cat) throw new ConflictError(404, '分类不存在')
    }
    await this.db
      .updateTable('video_bloggers')
      .set({ category_id: categoryId })
      .where('id', '=', bloggerId)
      .where('user_id', '=', userId)
      .execute()
  }

  /** 删博主:视频级联删(DDL ON DELETE CASCADE)。 */
  async deleteBlogger(userId: number, bloggerId: number) {
    await this.db
      .deleteFrom('video_bloggers')
      .where('id', '=', bloggerId)
      .where('user_id', '=', userId)
      .execute()
  }

  async createCategory(userId: number, name: string): Promise<VideoCategory> {
    const row = await this.db
      .insertInto('video_categories')
      .values({ user_id: userId, name, sort_order: 0, created_at: nowIso() })
      .returningAll()
      .executeTakeFirstOrThrow()
    return { id: row.id, name: row.name, sortOrder: row.sort_order }
  }

  async renameCategory(userId: number, categoryId: number, name: string) {
    await this.db
      .updateTable('video_categories')
      .set({ name })
      .where('id', '=', categoryId)
      .where('user_id', '=', userId)
      .executeTakeFirstOrThrow(() => new ConflictError(404, '分类不存在'))
  }

  /** 删分类:博主经 DDL ON DELETE SET NULL 回未分类。 */
  async deleteCategory(userId: number, categoryId: number) {
    await this.db
      .deleteFrom('video_categories')
      .where('id', '=', categoryId)
      .where('user_id', '=', userId)
      .execute()
  }

  async reorderCategories(userId: number, ids: number[]) {
    for (const [i, id] of ids.entries()) {
      await this.db
        .updateTable('video_categories')
        .set({ sort_order: i })
        .where('id', '=', id)
        .where('user_id', '=', userId)
        .execute()
    }
  }

  // —— 轮询与首取(尾链内串行)——

  /** cron 入口:全量轮询入队,失败只记日志(轮询即天然重试,禁密集重试)。 */
  pollAllQuietly(): void {
    void this.enqueue(() => this.pollAll())
  }

  /** 等待尾链排空(测试对账;生产无消费方)。 */
  async idle(): Promise<void> {
    await this.tail
  }

  private async pollAll() {
    const bloggers = await this.db.selectFrom('video_bloggers').selectAll().execute()
    for (const b of bloggers) {
      // B站 UP 间随机 5–15s 错峰(研究口径:同接口短时间被同 IP 多次请求即触发风控)
      if (b.platform === 'bilibili') await this.deps.sleep(5_000 + Math.random() * 10_000)
      await this.pollOrBackfill(b, false)
    }
  }

  /** 首添补历史:YouTube 有 key 时 API 取满 50(playlistItems + videos.list 补时长),B站翻 2 页。 */
  private async backfill(bloggerId: number) {
    const b = await this.db
      .selectFrom('video_bloggers')
      .selectAll()
      .where('id', '=', bloggerId)
      .executeTakeFirst()
    if (b) await this.pollOrBackfill(b, true)
  }

  /** 单博主一轮:deep=首添补历史(YouTube API 50 条/B站 2 页),否则轮询增量(YouTube RSS/B站 1 页)。 */
  private async pollOrBackfill(b: BloggerRow, deep: boolean) {
    try {
      let items: FeedVideo[]
      if (b.platform === 'youtube') {
        items =
          deep && this.deps.youtubeApiKey
            ? await this.youtubeApiHistory(b.platform_user_id)
            : await this.youtubeRssVideos(b)
      } else {
        if (!this.deps.bilibiliCookie) throw new Error('BILIBILI_COOKIE 未配置(轮询必然失败)')
        const pages = deep ? 2 : 1
        items = []
        for (let pn = 1; pn <= pages; pn++) {
          if (pn > 1) await this.deps.sleep(5_000) // 同 UP 翻页间隔,同错峰口径
          items.push(...(await this.biliArcSearch(b.platform_user_id, pn)))
        }
      }
      await this.saveVideos(b, items)
      await this.markSuccess(b.id)
    } catch (e) {
      await this.markFailure(b, e)
    }
  }

  private async markSuccess(bloggerId: number) {
    await this.db
      .updateTable('video_bloggers')
      .set({ fail_streak: 0, status: 'ok' })
      .where('id', '=', bloggerId)
      .execute()
  }

  private async markFailure(b: BloggerRow, e: unknown) {
    const streak = b.fail_streak + 1
    await this.db
      .updateTable('video_bloggers')
      .set({ fail_streak: streak, status: streak >= FAIL_STREAK_LIMIT ? 'failing' : b.status })
      .where('id', '=', b.id)
      .execute()
    console.error(`视频更新(${b.platform}/${b.name})取数失败(连续 ${streak} 轮):`, e)
  }

  /** 入库(upsert 防重)+ 同事务裁剪 50 条窗口;顺带用 feed 携带的作者名刷新博主名(免费信息)。 */
  private async saveVideos(b: BloggerRow, items: FeedVideo[]) {
    await this.db.transaction().execute(async (tx) => {
      for (const it of items) {
        await tx
          .insertInto('videos')
          .values({
            blogger_id: b.id,
            platform_video_id: it.videoId,
            title: it.title,
            url: it.url,
            thumbnail_url: it.thumbnailUrl,
            duration_seconds: it.durationSeconds,
            published_at: it.publishedAt,
            created_at: nowIso(),
          })
          .onConflict((oc) => oc.columns(['blogger_id', 'platform_video_id']).doNothing())
          .execute()
      }
      await tx
        .deleteFrom('videos')
        .where('blogger_id', '=', b.id)
        .where('id', 'not in', (eb) =>
          eb
            .selectFrom('videos')
            .select('id')
            .where('blogger_id', '=', b.id)
            .orderBy('published_at', 'desc')
            .limit(KEEP_PER_BLOGGER),
        )
        .execute()
    })
    const name = items[0]?.authorName
    if (name && name !== b.name) {
      await this.db.updateTable('video_bloggers').set({ name }).where('id', '=', b.id).execute()
    }
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn, fn) // 前序失败不阻塞后来者
    this.tail = run.catch(() => {})
    return run
  }

  // —— 取数(YouTube / B站;全部经 deps.fetchText)——

  /** YouTube 博主元信息:有 key 且非 custom 走 channels.list(一步拿 id+昵称+头像);
   *  其余(无 key 任意形态 / 有 key 的 custom——API 无对应参数)走频道页一次性解析
   *  (canonical 定 id + og 昵称头像,1.6MB 一次性,研究实测各形态均有)。 */
  private async resolveYouTube(parsed: {
    kind: 'channel' | 'handle' | 'custom' | 'user'
    value: string
  }): Promise<{ channelId: string; name: string; avatarUrl: string | null }> {
    const key = this.deps.youtubeApiKey
    if (key && parsed.kind !== 'custom') {
      const param: Record<string, string> =
        parsed.kind === 'channel' ? { id: parsed.value } : parsed.kind === 'handle' ? { forHandle: `@${parsed.value}` } : { forUsername: parsed.value }
      const json = (await this.ytApi('channels', {
        part: 'snippet',
        ...param,
      })) as { items?: Array<{ id: string; snippet?: { title?: string; thumbnails?: Record<string, { url: string }> } }> }
      const ch = json.items?.[0]
      if (!ch) throw new ConflictError(502, 'YouTube 上找不到该频道')
      return {
        channelId: ch.id,
        name: ch.snippet?.title ?? ch.id,
        avatarUrl: ch.snippet?.thumbnails?.medium?.url ?? ch.snippet?.thumbnails?.default?.url ?? null,
      }
    }
    const prefix = parsed.kind === 'handle' ? null : parsed.kind === 'custom' ? 'c' : parsed.kind
    const path = prefix === null ? `/@${parsed.value}` : `/${prefix}/${parsed.value}`
    const html = await this.deps.fetchText(`https://www.youtube.com${path}`, 60_000, {
      headers: { 'user-agent': BILI_UA },
    })
    // channel 形态 id 已在手,canonical 仅复核;其余形态从 canonical 提取
    const channelId =
      parsed.kind === 'channel'
        ? parsed.value
        : /\/channel\/(UC[\w-]+)/.exec(extractCanonical(html) ?? '')?.[1]
    if (!channelId) throw new ConflictError(502, '无法从该页面解析出频道')
    const og = extractOg(html)
    return { channelId, name: og.title ?? channelId, avatarUrl: og.image }
  }

  /** B站博主元信息:acc/info 匿名 + wbi 即稳(研究实测),mid 从 URL 直读。 */
  private async resolveBilibili(mid: string): Promise<{ channelId: string; name: string; avatarUrl: string | null }> {
    const mixin = await this.deps.getMixinKey()
    const { query, wRid } = buildWbiQuery({ mid }, mixin, nowSec())
    const json = JSON.parse(
      await this.deps.fetchText(
        `https://api.bilibili.com/x/space/wbi/acc/info?${query}&w_rid=${wRid}`,
        30_000,
        { headers: { 'user-agent': BILI_UA, referer: `https://space.bilibili.com/${mid}/` } },
      ),
    ) as { code?: number; data?: { name?: string; face?: string } }
    if (json.code !== 0 || !json.data?.name) throw new ConflictError(502, 'B站博主信息解析失败')
    return { channelId: mid, name: json.data.name, avatarUrl: httpsify(json.data.face ?? null) }
  }

  private rssUrl(channelId: string) {
    return `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`
  }

  /** RSS 轮询增量(0 配额变更检测);有 key 时对新条目攒批 videos.list 补时长(1 单位/批)。 */
  private async youtubeRssVideos(b: BloggerRow): Promise<FeedVideo[]> {
    const items = parseYouTubeRss(
      await this.deps.fetchText(this.rssUrl(b.platform_user_id), 30_000, { headers: { 'user-agent': BILI_UA } }),
    )
    if (items.length === 0) return items
    const known = new Set(
      (
        await this.db
          .selectFrom('videos')
          .select('platform_video_id')
          .where('blogger_id', '=', b.id)
          .execute()
      ).map((r) => r.platform_video_id),
    )
    const fresh = items.filter((v) => !known.has(v.videoId))
    if (fresh.length && this.deps.youtubeApiKey) {
      const durations = await this.ytDurations(fresh.map((v) => v.videoId))
      for (const v of fresh) v.durationSeconds = durations.get(v.videoId) ?? null
    }
    return items // 存量条目照常 upsert(幂等)且参与博主名刷新
  }

  /** 首添补历史:playlistItems 一次取满 50(1 单位)+ videos.list 批量补时长(1 单位)。 */
  private async youtubeApiHistory(channelId: string): Promise<FeedVideo[]> {
    const uploadsPlaylist = `UU${channelId.slice(1)}` // UC→UU 推导(官方口径 relatedPlaylists.uploads 的社区共识捷径,实测同值)
    const json = (await this.ytApi('playlistItems', {
      part: 'snippet',
      playlistId: uploadsPlaylist,
      maxResults: '50',
    })) as {
      items?: Array<{
        snippet?: {
          title?: string
          publishedAt?: string
          resourceId?: { videoId?: string }
          thumbnails?: Record<string, { url: string }>
        }
      }>
    }
    const items: FeedVideo[] = (json.items ?? [])
      .map((it) => ({
        videoId: it.snippet?.resourceId?.videoId ?? '',
        title: it.snippet?.title ?? '',
        url: `https://www.youtube.com/watch?v=${it.snippet?.resourceId?.videoId ?? ''}`,
        thumbnailUrl:
          it.snippet?.thumbnails?.medium?.url ?? it.snippet?.thumbnails?.default?.url ?? null,
        durationSeconds: null,
        publishedAt: it.snippet?.publishedAt ? Math.floor(Date.parse(it.snippet.publishedAt) / 1000) : 0,
        authorName: null, // playlistItems 无作者;博主名首添时已由元信息解析带回
      }))
      .filter((v) => v.videoId)
    if (items.length) {
      const durations = await this.ytDurations(items.map((v) => v.videoId))
      for (const v of items) v.durationSeconds = durations.get(v.videoId) ?? null
    }
    return items
  }

  /** Data API v3 通用调用(list 类 1 单位/次;错误照 changelog fetchText 语义抛)。 */
  private async ytApi(path: string, params: Record<string, string>): Promise<unknown> {
    const qs = new URLSearchParams({ ...params, key: this.deps.youtubeApiKey })
    return JSON.parse(
      await this.deps.fetchText(`https://www.googleapis.com/youtube/v3/${path}?${qs}`, 30_000),
    )
  }

  /** videos.list 批量(id 逗号分隔 ≤50)→ videoId → 秒。 */
  private async ytDurations(videoIds: string[]): Promise<Map<string, number | null>> {
    const out = new Map<string, number | null>()
    if (videoIds.length === 0) return out
    const json = (await this.ytApi('videos', {
      part: 'contentDetails',
      id: videoIds.slice(0, 50).join(','),
    })) as { items?: Array<{ id?: string; contentDetails?: { duration?: string } }> }
    for (const it of json.items ?? []) {
      if (it.id) out.set(it.id, it.contentDetails?.duration ? parseDurationSeconds(it.contentDetails.duration) : null)
    }
    return out
  }

  /** B站投稿列表(arc/search,pn 页码 / ps=30):带登录 Cookie + wbi + dm_img 假指纹(研究 §7:零成本贴近生态形态,稳定性依据仍是 Cookie)。 */
  private async biliArcSearch(mid: string, pn: number): Promise<FeedVideo[]> {
    const mixin = await this.deps.getMixinKey()
    const { query, wRid } = buildWbiQuery(
      {
        mid,
        order: 'pubdate',
        tid: '0',
        pn: String(pn),
        ps: '30',
        platform: 'web',
        order_avoided: 'true',
        dm_img_list: '[]',
        dm_img_str: 'V2ViR0w=',
        dm_img_inter: '[]',
      },
      mixin,
      nowSec(),
    )
    const json = JSON.parse(
      await this.deps.fetchText(
        `https://api.bilibili.com/x/space/wbi/arc/search?${query}&w_rid=${wRid}`,
        30_000,
        {
          headers: {
            'user-agent': BILI_UA,
            cookie: this.deps.bilibiliCookie,
            referer: `https://space.bilibili.com/${mid}/`,
          },
        },
      ),
    ) as {
      code?: number
      data?: { list?: { vlist?: Array<{ bvid?: string; title?: string; pic?: string; length?: string; created?: number; author?: string }> } }
    }
    if (json.code !== 0) throw new Error(`B站接口 code ${json.code}(Cookie 失效或风控)`)
    return (json.data?.list?.vlist ?? [])
      .map((v) => ({
        videoId: v.bvid ?? '',
        title: v.title ?? '',
        url: `https://www.bilibili.com/video/${v.bvid ?? ''}`,
        thumbnailUrl: httpsify(v.pic ?? null),
        durationSeconds: v.length ? parseDurationSeconds(v.length) : null,
        publishedAt: v.created ?? 0,
        authorName: v.author ?? null,
      }))
      .filter((v) => v.videoId)
  }

  private toBloggerWire(r: BloggerRow): VideoBlogger {
    return {
      id: r.id,
      platform: r.platform as 'youtube' | 'bilibili',
      platformUserId: r.platform_user_id,
      name: r.name,
      avatarUrl: r.avatar_url ?? null,
      categoryId: r.category_id ?? null,
      status: r.status as 'ok' | 'failing',
    }
  }
}

// ---- HTTP 路由 ----

export function videoUpdatesRoutes(service: VideoUpdatesService): Hono<AuthEnv> {
  const userId = (c: Context<AuthEnv>) => c.get('user')!.id
  const body = async (c: Context<AuthEnv>) => await c.req.json().catch(() => null)
  const requireName = (v: unknown) => {
    if (typeof v !== 'string' || !v.trim()) throw new BadRequest('name: must not be blank')
    if (v.length > 64) throw new BadRequest('name: size must be between 0 and 64')
    return v.trim()
  }
  return new Hono<AuthEnv>()
    .get('/api/video-updates/videos', async (c) => c.json(await service.feed(userId(c))))
    .get('/api/video-updates/bloggers', async (c) => c.json(await service.bloggers(userId(c))))
    .get('/api/video-updates/categories', async (c) => c.json(await service.categories(userId(c))))
    .post('/api/video-updates/categories', async (c) => {
      const name = requireName((await body(c) as { name?: unknown })?.name)
      return c.json(await service.createCategory(userId(c), name), 201)
    })
    .put('/api/video-updates/categories/reorder', async (c) => {
      const ids = (await body(c) as { ids?: unknown })?.ids
      if (!Array.isArray(ids) || ids.some((v) => !Number.isInteger(v))) {
        throw new BadRequest('ids: 必须是整数数组')
      }
      await service.reorderCategories(userId(c), ids as number[])
      return c.json(await service.categories(userId(c)))
    })
    .put('/api/video-updates/categories/:id', async (c) => {
      const name = requireName((await body(c) as { name?: unknown })?.name)
      await service.renameCategory(userId(c), numericParam(c, 'id'), name)
      return c.json(await service.categories(userId(c)))
    })
    .delete('/api/video-updates/categories/:id', async (c) => {
      await service.deleteCategory(userId(c), numericParam(c, 'id'))
      return c.body(null, 204)
    })
    .post('/api/video-updates/bloggers', async (c) => {
      const url = (await body(c) as { url?: unknown })?.url
      if (typeof url !== 'string' || !url.trim()) throw new BadRequest('url: must not be blank')
      return c.json(await service.addBlogger(userId(c), url), 201)
    })
    .put('/api/video-updates/bloggers/:id', async (c) => {
      const categoryId = (await body(c) as { categoryId?: unknown })?.categoryId
      if (categoryId !== null && !Number.isInteger(categoryId)) {
        throw new BadRequest('categoryId: 必须是整数或 null')
      }
      await service.setBloggerCategory(userId(c), numericParam(c, 'id'), categoryId as number | null)
      return c.body(null, 204)
    })
    .delete('/api/video-updates/bloggers/:id', async (c) => {
      await service.deleteBlogger(userId(c), numericParam(c, 'id'))
      return c.body(null, 204)
    })
}

// ---- 生产协作器 ----

/** 上游文本抓取(复制自 changelog.ts fetchText:第二处同形,照 common.ts TtlCache 注释口径,第三处再提取)。 */
async function prodFetchText(url: string, timeoutMs: number, init?: RequestInit): Promise<string> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) {
    throw Object.assign(new Error(`${init?.method ?? 'GET'} ${url} → HTTP ${res.status}`), {
      status: res.status,
      body: (await res.text()).slice(0, 200),
    })
  }
  return res.text()
}

export function prodVideoDeps(env: NodeJS.ProcessEnv = process.env): VideoDeps {
  // wbi key 按日更替:12h 缓存保证最坏半天内换新(签名错误典型 -352/-412,下轮重取自愈)
  const wbiCache = new TtlCache<string>()
  return {
    fetchText: prodFetchText,
    getMixinKey: async () => {
      const cached = wbiCache.get('mixin')
      if (cached) return cached
      const json = JSON.parse(
        await prodFetchText('https://api.bilibili.com/x/web-interface/nav', 15_000, {
          headers: { 'user-agent': BILI_UA },
        }),
      ) as { data?: { wbi_img?: { img_url?: string; sub_url?: string } } }
      const imgKey = /([^/]+)\.png/.exec(json.data?.wbi_img?.img_url ?? '')?.[1]
      const subKey = /([^/]+)\.png/.exec(json.data?.wbi_img?.sub_url ?? '')?.[1]
      if (!imgKey || !subKey) throw new Error('nav 接口未返回 wbi key')
      const key = mixinKey(imgKey, subKey)
      wbiCache.put('mixin', key, 12 * 3600 * 1000)
      return key
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    youtubeApiKey: env.YOUTUBE_API_KEY ?? '',
    bilibiliCookie: env.BILIBILI_COOKIE ?? '',
  }
}

// ---- 定时轮询(spec:非整点错开整点请求高峰;与更新日志调度互不干涉)----

export function startVideoUpdatesScheduler(service: VideoUpdatesService): void {
  schedule('23 * * * *', () => service.pollAllQuietly())
}
