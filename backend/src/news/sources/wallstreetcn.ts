import { normalizeSecond } from '../parse'
import { FETCH_TIMEOUT, newsHeaders, type NewsGetter, type PortedNewsItem } from './types'

/** 华尔街见闻快讯(newnow server/sources/wallstreetcn.ts 的 live 子源移植);display_time 为秒级时间戳。 */
export function parseWallstreetcn(json: unknown): PortedNewsItem[] {
  const items = (json as { data?: { items?: unknown } })?.data?.items
  if (!Array.isArray(items)) return []
  const out: PortedNewsItem[] = []
  for (const k of items as Array<Record<string, unknown>>) {
    const id = k['id'] === undefined ? '' : String(k['id'])
    const title = typeof k['title'] === 'string' && k['title'] ? k['title'] : typeof k['content_text'] === 'string' ? k['content_text'] : ''
    const uri = typeof k['uri'] === 'string' ? k['uri'] : ''
    if (id && title && uri) out.push({ id, title, url: uri, publishedAt: normalizeSecond(k['display_time']) })
  }
  return out
}

const fetchWallstreetcn: NewsGetter = async (d) =>
  parseWallstreetcn(
    JSON.parse(
      await d.fetchText(
        'https://api-one.wallstcn.com/apiv1/content/lives?channel=global-channel&limit=30',
        FETCH_TIMEOUT,
        newsHeaders(),
      ),
    ),
  )

export default fetchWallstreetcn
