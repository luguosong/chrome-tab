import { FETCH_TIMEOUT, newsHeaders, type NewsGetter, type PortedNewsItem } from './types'

/** 知乎热榜(newnow server/sources/zhihu.ts 移植)。热榜无逐条发布时间。 */
export function parseZhihu(json: unknown): PortedNewsItem[] {
  const data = (json as { data?: unknown })?.data
  if (!Array.isArray(data)) return []
  const out: PortedNewsItem[] = []
  for (const k of data as Array<Record<string, unknown>>) {
    const target = k['target'] as Record<string, Record<string, string>> | undefined
    const title = target?.['title_area']?.['text']
    const url = target?.['link']?.['url']
    if (title && url) out.push({ id: /(\d+)$/.exec(url)?.[1] ?? url, title, url, publishedAt: null })
  }
  return out
}

const fetchZhihu: NewsGetter = async (d) =>
  parseZhihu(
    JSON.parse(
      await d.fetchText(
        'https://www.zhihu.com/api/v3/feed/topstory/hot-list-web?limit=20&desktop=true',
        FETCH_TIMEOUT,
        newsHeaders(),
      ),
    ),
  )

export default fetchZhihu
