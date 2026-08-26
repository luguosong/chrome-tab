import { schedule } from 'node-cron'
import { sql } from 'kysely'
import { Hono, type Context } from 'hono'
import { NEWS_SOURCES, type NewsFeedResponse, type NewsItem, type NewsSourceId, type NewsSourceState } from 'chrome-tab-shared'
import { BadRequest, fetchBuffer, fetchText } from '../common'
import type { Db } from '../db'
import type { AuthEnv } from '../auth'
import type { NewsDeps } from './sources/types'
import { NEWS_GETTERS } from './sources'
import { makeTranslationStore, type TranslationStore } from '../translate'
import { prodTitleTranslator, TRANSLATED_SOURCES } from './translate'

/**
 * 「新闻」(CONTEXT.md「新闻/新闻源」;ADR-0027):15 内置源、账号级勾选、cron 30min
 * 预取落库(对齐视频更新范式 ADR-0023)。条目池按源全局共享(同源任一勾选用户触发
 * 抓取,全部受益)——轮询按 distinct source 去重抓一次,状态行按 user×source 同步。
 * 降级:连续 48 轮(30min/轮 = 1 天)失败标 failing 不删数据,成功即回 ok。
 * 排序:COALESCE(published_at, 入库秒) 降序——热榜类无逐条时间条目以入库时间为代理。
 */

/** 每源滚动保留窗口(spec):入库后同事务按 id 降序裁剪。 */
const KEEP_PER_SOURCE = 50
/** 连续失败多少轮(30min/轮 = 1 天)标 failing(spec)。 */
const FAIL_STREAK_LIMIT = 48

const nowIso = () => new Date().toISOString()
const VALID_SOURCES = new Set(NEWS_SOURCES.map((s) => s.id))

export class NewsService {
  /** 同 VideoUpdatesService.exclusive:勾选首取与 cron 轮询排一条链串行。 */
  private tail: Promise<unknown> = Promise.resolve()

  /** 标题译文仓(ADR-0034):原文键 load/ensure,哈希派生与补译骨架收进 store。 */
  private readonly translations: TranslationStore

  constructor(
    private readonly db: Db,
    private readonly deps: NewsDeps,
  ) {
    this.translations = makeTranslationStore(db, 'news_translations')
    // github 源退役(剥离为独立「GitHub 趋势」图标,ADR-0028):清掉旧条目池与勾选
    // 状态行的孤儿数据。幂等,每次启动跑一次零成本;不清也无害(feed 只读用户勾选行,
    // VALID_SOURCES 已不含该源),留着只是脏数据。catch 防 DB 失败成 unhandled rejection。
    this.db.deleteFrom('news_items').where('source', '=', 'github').execute()
      .catch((e) => console.error('退役源条目清理失败:', e))
    this.db.deleteFrom('news_sources').where('source', '=', 'github').execute()
      .catch((e) => console.error('退役源勾选清理失败:', e))
  }

  // —— 读侧(路由直调;库即真相)——

  async feed(userId: number): Promise<NewsFeedResponse> {
    const rows = await this.db
      .selectFrom('news_sources')
      .selectAll()
      .where('user_id', '=', userId)
      .where('enabled', '=', 1)
      .execute()
    const sources: NewsSourceState[] = rows.map((r) => ({
      id: r.source as NewsSourceId,
      status: r.status as 'ok' | 'failing',
      lastSuccessAt: r.last_success_at,
    }))
    if (rows.length === 0) return { items: [], sources }
    const items = await this.db
      .selectFrom('news_items')
      .select(['id', 'source', 'title', 'url', 'published_at'])
      .where(
        'source',
        'in',
        rows.map((r) => r.source),
      )
      .orderBy(sql`coalesce(published_at, cast(strftime('%s', created_at) as integer))`, 'desc')
      .orderBy('id', 'desc')
      .execute()
    // 标题译文拼装(ADR-0029):译文表按标题哈希独立于条目池,读侧内存 join(SQLite 无
    // 内置 sha256,不在 SQL 侧算)。无英文源条目直接跳过——纯中文勾选(最常见配置)
    // 不白付一次注定为空的查询(code-review)
    const zh = items.some((r) => TRANSLATED_SOURCES.has(r.source as NewsSourceId))
      ? await this.translations.load(items.map((r) => r.title))
      : new Map<string, string>()
    return {
      items: items.map((r) => ({
        id: r.id,
        source: r.source as NewsSourceId,
        title: r.title,
        titleZh: zh.get(r.title) ?? null,
        url: r.url,
        publishedAt: r.published_at ?? null,
      })) satisfies NewsItem[],
      sources,
    }
  }

  // —— 勾选管理 ——(整份替换 = 差集增删;保留源不动状态行,仅新勾源投递首取)

  async setSources(userId: number, ids: NewsSourceId[]): Promise<NewsFeedResponse> {
    const unique = [...new Set(ids)]
    const prev = new Set(
      (
        await this.db
          .selectFrom('news_sources')
          .select('source')
          .where('user_id', '=', userId)
          .execute()
      ).map((r) => r.source),
    )
    const added = unique.filter((s) => !prev.has(s))
    await this.db.transaction().execute(async (tx) => {
      // 取消勾选 = 删行(条目池不动,重勾即复用);保留行原样——failing 标记与最近
      // 抓取时间是有价值的状态,不因改勾选而清零重计
      if (unique.length === 0) {
        await tx.deleteFrom('news_sources').where('user_id', '=', userId).execute()
      } else {
        await tx
          .deleteFrom('news_sources')
          .where('user_id', '=', userId)
          .where('source', 'not in', unique)
          .execute()
      }
      for (const source of added) {
        await tx
          .insertInto('news_sources')
          .values({ user_id: userId, source, enabled: 1, fail_streak: 0, status: 'ok', created_at: nowIso() })
          .execute()
      }
    })
    // 仅新勾源即时首取(整份重抓会放大上游请求,且新源要排在重抓的冗余任务后面)
    for (const source of added) void this.enqueue(() => this.pollSource(source))
    return this.feed(userId)
  }

  // —— 轮询(尾链内串行)——

  pollAllQuietly(): void {
    void this.enqueue(() => this.pollAll())
  }

  /** 等待尾链排空(测试对账)。 */
  async idle(): Promise<void> {
    await this.tail
  }

  private async pollAll() {
    const rows = await this.db
      .selectFrom('news_sources')
      .select('source')
      .where('enabled', '=', 1)
      .execute()
    const sources = [...new Set(rows.map((r) => r.source))]
    // cron 活性打点(2026-08-26 事故:部署后零译制日志,无从区分「没到 cron 点/没执行/
    // 静默跳过」,只能靠时间线推理);48 行/天,取数失败另有 error,成功以 DB 状态行为准
    console.log(`[news] 轮询开始:${sources.length} 源`)
    for (const source of sources) {
      await this.pollSource(source)
    }
  }

  /**
   * 单源一轮:抓取 → 入库裁剪 → 同步该源全部勾选用户状态行;失败按 streak 口径标记。
   * 条目池空(= 勾选首取)时失败立即补试一次:瞬时抖动不至于让新勾源空 tab 干等下一
   * 轮 cron(30min);池非空的常规轮不补试,不放大上游请求(cron 下轮即天然重试)。
   */
  private async pollSource(source: string, retried = false): Promise<void> {
    const getter = NEWS_GETTERS[source as NewsSourceId]
    if (!getter) return
    try {
      const items = await getter(this.deps)
      // 空结果视为失败(上游改版/风控墙常见形态:HTTP 200 但解析得 0 条)——不清 streak、
      // 不刷新鲜度,48 轮口径能捕捉到静默冻结(v2ex「不掩盖半瘫」口径全源适用)
      if (items.length === 0) throw new Error('上游返回 0 条(疑似改版或风控拦截)')
      await this.saveItems(source, items)
      await this.db
        .updateTable('news_sources')
        .set({ fail_streak: 0, status: 'ok', last_success_at: nowIso() })
        .where('source', '=', source)
        .where('enabled', '=', 1)
        .execute()
      // 英文源补译(ADR-0029)在状态行之后:译制是增值步骤,失败不影响取数成功语义
      // (db 的 source 列写入时经 VALID_SOURCES 校验,读出收窄为 NewsSourceId 安全)
      if (TRANSLATED_SOURCES.has(source as NewsSourceId)) await this.translateMissing(source)
    } catch (e) {
      if (!retried) {
        const pool = await this.db
          .selectFrom('news_items')
          .select('id')
          .where('source', '=', source)
          .limit(1)
          .execute()
        if (pool.length === 0) return this.pollSource(source, true)
      }
      await this.db
        .updateTable('news_sources')
        .set({
          fail_streak: sql`fail_streak + 1`,
          status: sql`case when fail_streak + 1 >= ${FAIL_STREAK_LIMIT} then 'failing' else status end`,
        })
        .where('source', '=', source)
        .where('enabled', '=', 1)
        .execute()
      console.error(`新闻源 ${source} 取数失败:`, e)
    }
  }

  /** 入库(upsert 防重)+ 同事务裁剪 50 条窗口(按 id 降序,spec 口径)。 */
  private async saveItems(source: string, items: Array<{ id: string; title: string; url: string; publishedAt: number | null }>) {
    if (items.length === 0) return
    await this.db.transaction().execute(async (tx) => {
      for (const it of items) {
        await tx
          .insertInto('news_items')
          .values({
            source,
            item_id: it.id,
            title: it.title,
            url: it.url,
            published_at: it.publishedAt,
            created_at: nowIso(),
          })
          .onConflict((oc) => oc.columns(['source', 'item_id']).doNothing())
          .execute()
      }
      await tx
        .deleteFrom('news_items')
        .where('source', '=', source)
        .where('id', 'not in', (eb) =>
          eb
            .selectFrom('news_items')
            .select('id')
            .where('source', '=', source)
            // 裁剪键与 feed 排序同口径(coalesce 数值比较):聚合源多 feed 拼接时按新鲜度
            // 而非插入序保留,窗口稳定不逐轮翻转(裸 id 会把首个 feed 的条目整批删光)
            .orderBy(sql`coalesce(published_at, cast(strftime('%s', created_at) as integer))`, 'desc')
            .orderBy('id', 'desc')
            .limit(KEEP_PER_SOURCE),
        )
        .execute()
    })
  }

  /** 英文源补译(ADR-0029):扫该源池内缺译文标题 → 批量译 → 写哈希表;失败仅 warn
   *  不写表,下一轮 pollSource(30min)自然重试。存量补译零额外机制:上线首轮扫到的
   *  全是缺译文行,天然全量补译。整体 try:译制(含自身 DB 读写)任何失败都不冒泡进
   *  pollSource——那里会错标 fail_streak、日志误归因「取数失败」。 */
  private async translateMissing(source: string): Promise<void> {
    try {
      const titles = [
        ...new Set(
          (await this.db.selectFrom('news_items').select('title').where('source', '=', source).execute()).map((r) => r.title),
        ),
      ]
      if (titles.length === 0) return
      // 含换行标题剔出译制集(域过滤):逐行编号协议里必然配对失败,留在集合里只会
      // 每轮重发网关计费(code-review);保持英文(宁英勿空),裁剪出窗即自然淘汰。
      // 骨架(去重/滤缺/批译/null 丢弃/onConflict)收在译文仓 ensure(ADR-0034)
      await this.translations.ensure(titles, this.deps.translateTitles, (t) => !t.includes('\n'))
    } catch (e) {
      console.warn(`新闻源 ${source} 标题译制失败,保持英文:`, e)
    }
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn, fn)
    this.tail = run.catch(() => {})
    return run
  }
}

// ---- HTTP 路由 ----

export function newsRoutes(service: NewsService): Hono<AuthEnv> {
  const userId = (c: Context<AuthEnv>) => c.get('user')!.id
  return new Hono<AuthEnv>()
    .get('/api/news/feed', async (c) => c.json(await service.feed(userId(c))))
    .put('/api/news/sources', async (c) => {
      const body = (await c.req.json().catch(() => null)) as { sources?: unknown } | null
      const ids = body?.sources
      if (!Array.isArray(ids) || ids.some((v) => typeof v !== 'string' || !VALID_SOURCES.has(v as NewsSourceId))) {
        throw new BadRequest('sources: 必须是新闻源 id 数组')
      }
      return c.json(await service.setSources(userId(c), ids as NewsSourceId[]))
    })
}

// ---- 生产协作器与调度 ----

export function prodNewsDeps(): NewsDeps {
  return { fetchText, fetchBuffer, translateTitles: prodTitleTranslator() }
}

/** 30min 一轮(每小时 11/41 分,错开整点与既有调度器;库即真相,无启动预热)。 */
export function startNewsScheduler(service: NewsService): void {
  schedule('11,41 * * * *', () => service.pollAllQuietly())
}
