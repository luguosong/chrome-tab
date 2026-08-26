import { FETCH_TIMEOUT, newsHeaders, type NewsGetter, type PortedNewsItem } from './types'

/** 少数派热门文章(newnow server/sources/sspai.ts 移植)。无逐条发布时间。 */
export function parseSspai(json: unknown): PortedNewsItem[] {
  const data = (json as { data?: unknown })?.data
  if (!Array.isArray(data)) return []
  const out: PortedNewsItem[] = []
  for (const k of data as Array<Record<string, unknown>>) {
    const id = typeof k['id'] === 'number' ? String(k['id']) : ''
    const title = typeof k['title'] === 'string' ? k['title'] : ''
    if (id && title) out.push({ id, title, url: `https://sspai.com/post/${id}`, publishedAt: null })
  }
  return out
}

const fetchSspai: NewsGetter = async (d) => {
  const url = `https://sspai.com/api/v1/article/tag/page/get?limit=30&offset=0&created_at=${Date.now()}&tag=%E7%83%AD%E9%97%A8%E6%96%87%E7%AB%A0&released=false`
  return parseSspai(JSON.parse(await d.fetchText(url, FETCH_TIMEOUT, newsHeaders())))
}

export default fetchSspai
