/**
 * 「新闻」的「新闻源」内置枚举(CONTEXT.md「新闻源」;ADR-0027):代码即配置,
 * 前后端共享(同「外源」changelogSources 模式)。抓取函数在后端
 * backend/src/news/sources/(移植自 newsnow main,MIT);本文件只放源 id、
 * 展示名与 wire 契约。用户只能在详情 Modal「管理」tab 勾选启用/停用,不能自定义源。
 */

export type NewsSourceId =
  | 'zhihu'
  | 'weibo'
  | 'baidu'
  | 'thepaper'
  | 'ithome'
  | '36kr'
  | 'sspai'
  | 'solidot'
  | 'hackernews'
  | 'v2ex'
  | 'producthunt'
  | 'cls'
  | 'wallstreetcn'
  | 'zaobao'
  | 'cankaoxiaoxi'

export interface NewsSourceDef {
  id: NewsSourceId
  /** 展示名(tile 行内「源名」与 Modal tab/管理清单用)。 */
  label: string
}

/** 15 源,顺序即「管理」平铺清单顺序(热点 → 科技 → 开发者 → 财经 → 中文外媒)。
 *  GitHub Trending 已剥离为独立「GitHub 趋势」图标(ADR-0028),不再是新闻源。 */
export const NEWS_SOURCES: readonly NewsSourceDef[] = [
  { id: 'zhihu', label: '知乎' },
  { id: 'weibo', label: '微博' },
  { id: 'baidu', label: '百度' },
  { id: 'thepaper', label: '澎湃' },
  { id: 'ithome', label: 'IT之家' },
  { id: '36kr', label: '36氪' },
  { id: 'sspai', label: '少数派' },
  { id: 'solidot', label: 'Solidot' },
  { id: 'hackernews', label: 'Hacker News' },
  { id: 'v2ex', label: 'V2EX' },
  { id: 'producthunt', label: 'Product Hunt' },
  { id: 'cls', label: '财联社电报' },
  { id: 'wallstreetcn', label: '华尔街见闻' },
  { id: 'zaobao', label: '联合早报' },
  { id: 'cankaoxiaoxi', label: '参考消息' },
]

/** id → 展示名(未知 id 回落 id 本身,防御读侧)。 */
export function newsSourceLabel(id: NewsSourceId): string {
  return NEWS_SOURCES.find((s) => s.id === id)?.label ?? id
}

// ── wire 契约(GET /api/news/feed、PUT /api/news/sources)────────────────────

/** 单条新闻(排序见 spec:COALESCE(published_at, 入库时间) 降序)。 */
export type NewsItem = {
  id: number
  source: NewsSourceId
  title: string
  /** 英文源标题的中文译文(ADR-0029);null = 译制中/失败/未配 Key,前端保持英文原文。 */
  titleZh: string | null
  url: string
  /** unix 秒;null = 热榜类源上游无逐条发布时间(行内时间省缺、24h 红点不生效)。 */
  publishedAt: number | null
}

/** 勾选源的取数状态(出现在 feed.sources 即已勾选;管理清单 = 全枚举 ∪ 本状态)。 */
export type NewsSourceState = {
  id: NewsSourceId
  /** 连续 48 轮取数失败标 failing(不删数据,成功即回 ok)。 */
  status: 'ok' | 'failing'
  /** 最近一次成功抓取(ISO);null = 勾选后首取未成/未完成。tile 鲜度取各源 max。 */
  lastSuccessAt: string | null
}

/** GET /api/news/feed 信封。 */
export type NewsFeedResponse = {
  items: NewsItem[]
  sources: NewsSourceState[]
}
