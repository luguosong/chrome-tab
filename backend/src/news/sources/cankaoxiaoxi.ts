import { parseBeijingSecond } from '../parse'
import { FETCH_TIMEOUT, newsHeaders, type NewsGetter, type PortedNewsItem } from './types'

/** 参考消息(newnow server/sources/cankaoxiaoxi.ts 移植):三频道 JSON;publishTime 为北京时间墙钟文本。 */
export function parseCankaoxiaoxi(feeds: unknown[]): PortedNewsItem[] {
  const out: PortedNewsItem[] = []
  for (const feed of feeds) {
    const lists = (feed as { list?: unknown })?.list
    if (!Array.isArray(lists)) continue
    for (const group of lists as Array<{ data?: unknown }>) {
      const data = group['data']
      if (!data || typeof data !== 'object') continue
      const rec = data as Record<string, unknown>
      const id = typeof rec['id'] === 'string' ? rec['id'] : ''
      const title = typeof rec['title'] === 'string' ? rec['title'] : ''
      const url = typeof rec['url'] === 'string' ? rec['url'] : ''
      const publishTime = typeof rec['publishTime'] === 'string' ? rec['publishTime'] : ''
      if (id && title && url) out.push({ id, title, url, publishedAt: parseBeijingSecond(publishTime) })
    }
  }
  return out
}

const CHANNELS = ['zhongguo', 'guandian', 'gj'] as const

const fetchCankaoxiaoxi: NewsGetter = async (d) => {
  const feeds = await Promise.all(
    CHANNELS.map(async (ch) =>
      // 明文 HTTP(上游仅提供 http 端点;服务器出站无强制 HTTPS)
      JSON.parse(await d.fetchText(`http://china.cankaoxiaoxi.com/json/channel/${ch}/list.json`, FETCH_TIMEOUT, newsHeaders())),
    ),
  )
  return parseCankaoxiaoxi(feeds)
}

export default fetchCankaoxiaoxi
