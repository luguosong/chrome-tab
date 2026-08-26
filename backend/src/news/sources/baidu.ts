import { FETCH_TIMEOUT, newsHeaders, type NewsGetter, type PortedNewsItem } from './types'

/** 百度热搜(newnow server/sources/baidu.ts 移植):页面内嵌 <!--s-data:--> JSON;置顶条目剔除。 */
export function parseBaidu(html: string): PortedNewsItem[] {
  const jsonStr = /<!--s-data:(.*?)-->/s.exec(html)?.[1]
  if (!jsonStr) return []
  let cards: unknown
  try {
    cards = (JSON.parse(jsonStr) as { data?: { cards?: unknown } })?.data?.cards
  } catch {
    return []
  }
  const content = Array.isArray(cards) ? (cards[0] as { content?: unknown })?.content : undefined
  if (!Array.isArray(content)) return []
  return content
    .filter((k): k is { word: string; rawUrl: string; isTop?: boolean } => !k['isTop'] && !!k['word'] && !!k['rawUrl'])
    .map((k) => ({ id: k.rawUrl, title: k.word, url: k.rawUrl, publishedAt: null }))
}

const fetchBaidu: NewsGetter = async (d) =>
  parseBaidu(await d.fetchText('https://top.baidu.com/board?tab=realtime', FETCH_TIMEOUT, newsHeaders()))

export default fetchBaidu
