import { Hono } from 'hono'
import { asRec, str } from './common'

/**
 * AIHOT 后端代理(CONTEXT.md「AI 热点」):单例图标类型的唯一取数来源,匿名只读、
 * 无 Key、无配置——上游是免费个人非商业档。两个视图:
 *  - 热点榜:GET /api/v1/hot-topics,事件级聚合排名流;
 *  - 模型精选:GET /api/v1/items?mode=selected&category=ai-models,精选流的
 *    「模型发布」分类(条目级 LLM 策展),7 天窗、至多 30 条,分类硬编码非用户可配。
 *
 * 缓存:内存单键 TTL 对齐各端点上游 s-maxage(热点 300s / 精选 60s;更密只会拿到
 * 同一份共享缓存副本);失败沿用上次成功数据(易失视图,宁旧勿空),从未成功返回
 * null(前端显示重试)。数据不落库——区别于更新日志的持久化译文;重启冷缓存重拉无感。
 *
 * 并发不去重(单例图标 + 前端 react-query 同 key 已去重,双发概率与代价都极低)。
 */

const TTL_MS = 5 * 60_000
const PICKS_TTL_MS = 60_000
const HOT_TOPICS_PATH = '/api/v1/hot-topics'
const MODEL_PICKS_PATH = '/api/v1/items?mode=selected&category=ai-models&window=7d&limit=30'
/** 匿名 actor 标识(上游约定 UA 携带;固定值,非账号非密钥,清库重签也不影响)。 */
const USER_AGENT = 'aihot-api/1.0 aihot-actor/3ed275ba-9f6b-42eb-bf9c-ef497cdc4853'
const DEFAULT_BASE = 'https://aihot.virxact.com'

// ── wire DTO(裁剪为前端消费的字段子集;防御式读取,脏条目跳过)──────────────────

export interface AihotTopicDto {
  rank: number
  title: string
  /** 首发来源名(source.name),热点条目无固定来源时为 null。 */
  sourceName: string | null
  /** AIHOT 站内事件页(时间线 + AI 综述),Modal 主跳目标。 */
  storyUrl: string | null
  /** 原文出处,Modal 次链接。 */
  originalUrl: string | null
  /** 报道源数(事件热度)。 */
  sourceCount: number
  /** 最新报道时间(ISO)。 */
  latestAt: string | null
}

/** 解析 hot-topics 响应:非数组 items 抛;条目缺 rank/title 跳过。纯函数可直测。 */
export function parseHotTopics(resp: unknown): AihotTopicDto[] {
  const items = asRec(resp)?.['items']
  if (!Array.isArray(items)) throw new Error('aihot hot-topics 缺 items')
  const out: AihotTopicDto[] = []
  for (const o of items) {
    const m = asRec(o)
    const rank = typeof m?.['rank'] === 'number' ? m['rank'] : NaN
    const title = str(m, 'title')
    if (!m || !Number.isInteger(rank) || !title) continue
    const links = asRec(m['links'])
    out.push({
      rank,
      title,
      sourceName: str(asRec(m['source']), 'name'),
      storyUrl: str(links, 'story'),
      originalUrl: str(links, 'original'),
      sourceCount: typeof m['sourceCount'] === 'number' ? m['sourceCount'] : 0,
      latestAt: str(m, 'latestAt'),
    })
  }
  return out
}

// ── 模型精选(精选流 × ai-models 分类;条目级,区别于热点榜的事件级)──────────────

export interface AihotModelPickDto {
  id: string
  title: string
  /** 来源名(source.name),如「DeepSeek:API 更新日志」。 */
  sourceName: string | null
  /** AIHOT 站内阅读页(中文摘要 + 原文入口),Modal 主跳目标。 */
  aihotUrl: string | null
  /** 第三方原文出处,Modal 次链接。 */
  originalUrl: string | null
  /** 原文发布时间(ISO);AIHOT 收录时间(discoveredAt)不透传。 */
  publishedAt: string | null
}

/** 解析 items 响应:非数组 items 抛;条目缺 id/title 跳过。纯函数可直测。 */
export function parseModelPicks(resp: unknown): AihotModelPickDto[] {
  const items = asRec(resp)?.['items']
  if (!Array.isArray(items)) throw new Error('aihot items 缺 items')
  const out: AihotModelPickDto[] = []
  for (const o of items) {
    const m = asRec(o)
    const id = str(m, 'id')
    const title = str(m, 'title')
    if (!m || !id || !title) continue
    const links = asRec(m['links'])
    out.push({
      id,
      title,
      sourceName: str(asRec(m['source']), 'name'),
      aihotUrl: str(links, 'aihot'),
      originalUrl: str(links, 'original'),
      publishedAt: str(m, 'publishedAt'),
    })
  }
  return out
}

// ── 服务(HTTP + 缓存;两个视图同形,第二次复用触发提取)────────────────────────

/** 单端点取数闭包:TTL 内回缓存,失败沿用 lastGood,从未成功为 null。 */
function createCachedSource<T>(baseUrl: string, path: string, ttlMs: number, parse: (resp: unknown) => T[]) {
  let cached: { at: number; data: T[] } | null = null
  let lastGood: T[] | null = null
  return async (): Promise<T[] | null> => {
    if (cached && Date.now() - cached.at < ttlMs) return cached.data
    try {
      const res = await fetch(new URL(path, baseUrl), { headers: { 'User-Agent': USER_AGENT } })
      if (!res.ok) throw new Error(`AIHOT 上游 HTTP ${res.status}`)
      const data = parse(await res.json())
      cached = { at: Date.now(), data }
      lastGood = data
      return data
    } catch (e) {
      console.warn(`AIHOT 取数失败(${path}): ${e}`)
      return lastGood
    }
  }
}

export function createAihotService(baseUrl = DEFAULT_BASE) {
  return {
    /** 当前热点榜;上游失败沿用旧数据,从未成功为 null。 */
    hotTopics: createCachedSource(baseUrl, HOT_TOPICS_PATH, TTL_MS, parseHotTopics),
    /** 模型精选(7 天窗);失败兜底同上。 */
    modelPicks: createCachedSource(baseUrl, MODEL_PICKS_PATH, PICKS_TTL_MS, parseModelPicks),
  }
}

/**
 * 端点(须在 requireAuth 之后挂载):
 * GET /api/aihot/hot-topics     → 当前热点榜(AihotTopicDto[];从未成功为 null,HTTP 仍 200)
 * GET /api/aihot/model-picks    → 模型精选(AihotModelPickDto[];同上)
 */
export function aihotRoutes(baseUrl?: string): Hono {
  const svc = createAihotService(baseUrl)
  return new Hono()
    .get('/api/aihot/hot-topics', async (c) => c.json(await svc.hotTopics()))
    .get('/api/aihot/model-picks', async (c) => c.json(await svc.modelPicks()))
}
