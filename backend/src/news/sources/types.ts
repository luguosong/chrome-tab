/**
 * 源抓取契约(ADR-0027):每源一个 getter,IO 经 deps 注入(测试塞假实现,同 VideoDeps
 * 范式)。统一 Chrome UA / 10s 超时,不做请求内重试——cron 轮询即天然重试(30min 后
 * 下一轮,失败按 48 轮口径标 failing)。抓取函数移植自 newnow(main,MIT,© 2024
 * ourongxing);selector/端点/请求头与上游保持一致,便于上游修版时对照跟进。
 */

export interface PortedNewsItem {
  /** 源内稳定 id(上游缺省时回落 url);入库键 (source, item_id)。 */
  id: string
  title: string
  url: string
  /** unix 秒;null = 热榜类源上游无逐条发布时间(行内时间省缺、红点不生效)。 */
  publishedAt: number | null
}

export interface NewsDeps {
  fetchText: (url: string, timeoutMs: number, init?: RequestInit) => Promise<string>
  /** 二进制抓取(联合早报 gb2312 页面)。 */
  fetchBuffer: (url: string, timeoutMs: number, init?: RequestInit) => Promise<ArrayBuffer>
}

export type NewsGetter = (d: NewsDeps) => Promise<PortedNewsItem[]>

/** newnow myFetch 同款 UA。 */
export const NEWS_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

export const newsHeaders = (extra: Record<string, string> = {}): RequestInit => ({
  headers: { 'user-agent': NEWS_UA, ...extra },
})

export const FETCH_TIMEOUT = 10_000
