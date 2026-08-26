import * as cheerio from 'cheerio'
import { FETCH_TIMEOUT, newsHeaders, type NewsGetter, type PortedNewsItem } from './types'

/** Hacker News 首页(newnow server/sources/hackernews.ts 移植);条目链到 HN 讨论页。无逐条发布时间。 */
export function parseHackernews(html: string): PortedNewsItem[] {
  const $ = cheerio.load(html)
  const base = 'https://news.ycombinator.com'
  const out: PortedNewsItem[] = []
  $('.athing').each((_, el) => {
    const a = $(el).find('.titleline a').first()
    const title = a.text()
    const id = $(el).attr('id')
    if (id && title) out.push({ url: `${base}/item?id=${id}`, title, id, publishedAt: null })
  })
  return out
}

const fetchHackernews: NewsGetter = async (d) =>
  parseHackernews(await d.fetchText('https://news.ycombinator.com', FETCH_TIMEOUT, newsHeaders()))

export default fetchHackernews
