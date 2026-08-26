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
  /** 英文源标题批量译制(ADR-0029;null = 该条未译成,保持英文)。测试塞假实现,同 translate 范式。 */
  translateTitles: (titles: string[]) => Promise<(string | null)[]>
}

export type NewsGetter = (d: NewsDeps) => Promise<PortedNewsItem[]>

// UA/超时/头已收归 common(「GitHub 趋势」剥离成第二消费者,2026-08-26);
// 旧名 re-export 保 15 个源文件与 siteInfo 零改动
export { FETCH_TIMEOUT, CHROME_UA as NEWS_UA, chromeHeaders as newsHeaders } from '../../common'
