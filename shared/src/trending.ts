/**
 * 「GitHub 趋势」的筛选词表与 wire 契约(CONTEXT.md「GitHub 趋势」;ADR-0028):
 * 前后端共享(同「新闻源」代码即配置模式)。GitHub Trending 无官方 API,数据靠
 * trending 页 HTML 解析;筛选组合(spoken × language × since)是笛卡尔积,只预取
 * 默认组合(今日 + 不限),其余组合按需现抓 + 后端内存缓存。
 */

/** 时间范围(GitHub since 参数);daily 为图标默认视图。 */
export type TrendingSince = 'daily' | 'weekly' | 'monthly'

/** since → 展示名(时间概念中文化;语言名保留英文原生,专有名词不译)。 */
export const TRENDING_SINCE_LABELS: Record<TrendingSince, string> = {
  daily: '今日',
  weekly: '本周',
  monthly: '本月',
}

/** 精选编程语言胶囊(GitHub 全量 300+ 语言不铺开;色值取 GitHub linguist 官方,胶囊与条目行内同色互证)。 */
export type TrendingLanguageDef = { slug: string; label: string; color: string }

export const TRENDING_LANGUAGES: readonly TrendingLanguageDef[] = [
  { slug: 'python', label: 'Python', color: '#3572a5' },
  { slug: 'typescript', label: 'TypeScript', color: '#3178c6' },
  { slug: 'javascript', label: 'JavaScript', color: '#f1e05a' },
  { slug: 'rust', label: 'Rust', color: '#dea584' },
  { slug: 'go', label: 'Go', color: '#00add8' },
  { slug: 'c++', label: 'C++', color: '#f34b7d' },
  { slug: 'c', label: 'C', color: '#555555' },
  { slug: 'c#', label: 'C#', color: '#178600' },
  { slug: 'java', label: 'Java', color: '#b07219' },
  { slug: 'swift', label: 'Swift', color: '#f05138' },
  { slug: 'kotlin', label: 'Kotlin', color: '#a97bff' },
  { slug: 'php', label: 'PHP', color: '#4f5d95' },
  { slug: 'ruby', label: 'Ruby', color: '#701516' },
]

/** 精选口语语言胶囊(GitHub spoken_language_code;全量为几百项 ISO 639 清单,不铺开)。口语无语言色,独立于编程语言的带色词表。 */
export type TrendingSpokenDef = { slug: string; label: string }

export const TRENDING_SPOKEN: readonly TrendingSpokenDef[] = [
  { slug: 'en', label: 'English' },
  { slug: 'zh', label: 'Chinese' },
  { slug: 'es', label: 'Spanish' },
  { slug: 'fr', label: 'French' },
  { slug: 'de', label: 'German' },
  { slug: 'ja', label: 'Japanese' },
  { slug: 'ko', label: 'Korean' },
  { slug: 'pt', label: 'Portuguese' },
  { slug: 'ru', label: 'Russian' },
  { slug: 'it', label: 'Italian' },
]

// ── wire 契约(GET /api/trending?since=&language=&spoken=)──────────────────

/** 单条趋势仓库。 */
export type TrendingRepo = {
  /** owner/name。 */
  repo: string
  url: string
  description: string | null
  /** 描述中译(ADR-0030:无汉字即视为非中文送 LLM 译制,译文按描述哈希终身复用);
   *  null = 未译/译制失败/无 Key/原文即中文/无描述。 */
  descriptionZh: string | null
  /** 编程语言名(英文原生,如 JavaScript);null = 未标语言。 */
  language: string | null
  /** linguist 语言色(GitHub 行内色点同源);null = 未标/未知语言。 */
  languageColor: string | null
  /** 总 star 数。 */
  stars: number
  /** 当前周期内新增 star(since=今日即今日增量)。 */
  periodStars: number
}

/** GET /api/trending 信封。 */
export type TrendingResponse = {
  repos: TrendingRepo[]
  /** 该组合缓存的抓取时刻(ISO);tile 标头鲜度。 */
  fetchedAt: string
}

// ── 已了解标记 wire(CONTEXT.md「已了解」;GET/PUT/DELETE /api/trending/marks)────

/** 已了解 repo(owner/name)集合:GET 即全量;PUT/DELETE 响应 = 写后最新全量
 *  (前端 onSuccess 权威写,同「新闻源」勾选范式)。集合语义,顺序无含义。
 *  PUT 请求体 = { repo };DELETE(取消)以同名 query 参数传同值(免 DELETE body)。 */
export type TrendingKnownMarks = string[]
