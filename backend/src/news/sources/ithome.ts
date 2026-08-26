import * as cheerio from 'cheerio'
import { parseBeijingSecond, parseRelativeSecond } from '../parse'
import { FETCH_TIMEOUT, newsHeaders, type NewsGetter, type PortedNewsItem } from './types'

/**
 * IT之家列表(newnow server/sources/ithome.ts 移植):列表页 li 里 <i> 的时间文本
 * 实测两种形态——相对(「10分钟前」)与绝对北京墙钟(「2026-08-26 11:14:21」),逐条
 * 双解析;广告条目照上游过滤。now 可注入(解析测试)。
 */
export function parseIthome(html: string, now: number = Date.now()): PortedNewsItem[] {
  const $ = cheerio.load(html)
  const out: PortedNewsItem[] = []
  $('#list > div.fl > ul > li').each((_, el) => {
    const $el = $(el)
    const $a = $el.find('a.t')
    const url = $a.attr('href')
    const title = $a.text()
    const date = $el.find('i').text()
    if (url && title && date) {
      const isAd = url.includes('lapin') || ['神券', '优惠', '补贴', '京东'].some((k) => title.includes(k))
      if (!isAd) out.push({ url, title, id: url, publishedAt: parseRelativeSecond(date, now) ?? parseBeijingSecond(date) })
    }
  })
  return out
}

const fetchIthome: NewsGetter = async (d) =>
  parseIthome(await d.fetchText('https://www.ithome.com/list/', FETCH_TIMEOUT, newsHeaders()))

export default fetchIthome
