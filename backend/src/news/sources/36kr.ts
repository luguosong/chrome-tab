import * as cheerio from 'cheerio'
import { parseRelativeSecond } from '../parse'
import { FETCH_TIMEOUT, newsHeaders, type NewsGetter, type PortedNewsItem } from './types'

/** 36氪快讯(newnow server/sources/_36kr.ts 的 quick 子源移植):SSR 页 .newsflash-item,.time 为相对时间。 */
export function parse36kr(html: string, now: number = Date.now()): PortedNewsItem[] {
  const $ = cheerio.load(html)
  const out: PortedNewsItem[] = []
  $('.newsflash-item').each((_, el) => {
    const $el = $(el)
    const $a = $el.find('a.item-title')
    const href = $a.attr('href')
    const title = $a.text()
    const relativeDate = $el.find('.time').text()
    if (href && title && relativeDate) {
      out.push({
        url: `https://www.36kr.com${href}`,
        title,
        id: href,
        publishedAt: parseRelativeSecond(relativeDate, now),
      })
    }
  })
  return out
}

const fetch36kr: NewsGetter = async (d) =>
  parse36kr(await d.fetchText('https://www.36kr.com/newsflashes', FETCH_TIMEOUT, newsHeaders()))

export default fetch36kr
