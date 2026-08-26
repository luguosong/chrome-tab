import { normalizeSecond } from '../parse'
import { FETCH_TIMEOUT, newsHeaders, type NewsGetter, type PortedNewsItem } from './types'

/** 澎湃热榜(newnow server/sources/thepaper.ts 移植)。pubTimeLong 为毫秒时间戳(启发式归一,异常值降级 null)。 */
export function parseThepaper(json: unknown): PortedNewsItem[] {
  const hotNews = (json as { data?: { hotNews?: unknown } })?.data?.hotNews
  if (!Array.isArray(hotNews)) return []
  const out: PortedNewsItem[] = []
  for (const k of hotNews as Array<Record<string, unknown>>) {
    const contId = typeof k['contId'] === 'string' || typeof k['contId'] === 'number' ? String(k['contId']) : ''
    const name = typeof k['name'] === 'string' ? k['name'] : ''
    if (contId && name) {
      out.push({
        id: contId,
        title: name,
        url: `https://www.thepaper.cn/newsDetail_forward_${contId}`,
        publishedAt: normalizeSecond(k['pubTimeLong']),
      })
    }
  }
  return out
}

const fetchThepaper: NewsGetter = async (d) =>
  parseThepaper(
    JSON.parse(
      await d.fetchText('https://cache.thepaper.cn/contentapi/wwwIndex/rightSidebar', FETCH_TIMEOUT, newsHeaders()),
    ),
  )

export default fetchThepaper
