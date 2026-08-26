import * as cheerio from 'cheerio'
import { FETCH_TIMEOUT, newsHeaders, type NewsGetter, type PortedNewsItem } from './types'

/** GitHub Trending(newnow server/sources/github.ts 移植):trending 页 HTML,标题为 repo 名。无逐条发布时间。 */
export function parseGithub(html: string): PortedNewsItem[] {
  const $ = cheerio.load(html)
  const out: PortedNewsItem[] = []
  $('main .Box div[data-hpc] > article').each((_, el) => {
    const a = $(el).find('>h2 a')
    const title = a.text().replace(/\n+/g, '').trim()
    const url = a.attr('href')
    if (url && title) {
      out.push({ url: `https://github.com${url}`, title, id: url, publishedAt: null })
    }
  })
  return out
}

const fetchGithub: NewsGetter = async (d) =>
  parseGithub(await d.fetchText('https://github.com/trending?spoken_language_code=', FETCH_TIMEOUT, newsHeaders()))

export default fetchGithub
