import { parseAbsoluteSecond } from '../parse'
import { FETCH_TIMEOUT, newsHeaders, type NewsGetter, type PortedNewsItem } from './types'

/**
 * V2EX(newnow server/sources/v2ex.ts 主源移植):四个 tab 的 JSON Feed 各拉一份聚合
 * (create/ideas/programmer/share),date_modified 为 ISO。空响应数组源会抛——四端点
 * 任一失败即整源失败(下轮重试),对齐上游不掩盖半瘫行为。
 */
export function parseV2ex(feeds: unknown[]): PortedNewsItem[] {
  const out: PortedNewsItem[] = []
  for (const feed of feeds) {
    const items = (feed as { items?: unknown })?.items
    if (!Array.isArray(items)) continue
    for (const k of items as Array<Record<string, unknown>>) {
      const id = typeof k['id'] === 'string' ? k['id'] : ''
      const title = typeof k['title'] === 'string' ? k['title'] : ''
      const url = typeof k['url'] === 'string' ? k['url'] : ''
      if (id && title && url) {
        // date_modified 仅少数条目携带(实测 50 条中约 10-18),date_published 全量有——
        // 上游 newsnow 同取 ?? 链,缺主取备,否则多数条目丢时间
        const dm = k['date_modified'] ?? k['date_published']
        out.push({
          id,
          title,
          url,
          publishedAt: typeof dm === 'string' ? parseAbsoluteSecond(dm) : null,
        })
      }
    }
  }
  return out
}

const TABS = ['create', 'ideas', 'programmer', 'share'] as const

const fetchV2ex: NewsGetter = async (d) => {
  const feeds = await Promise.all(
    TABS.map(async (tab) =>
      JSON.parse(await d.fetchText(`https://www.v2ex.com/feed/${tab}.json`, FETCH_TIMEOUT, newsHeaders())),
    ),
  )
  return parseV2ex(feeds)
}

export default fetchV2ex
