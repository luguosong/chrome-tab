import * as cheerio from 'cheerio'
import { FETCH_TIMEOUT, type NewsGetter, type PortedNewsItem } from './types'

/**
 * 微博实时热搜(newnow server/sources/weibo.ts 移植)。依赖上游硬编码的游客 SUB
 * Cookie(过期 → 该源取数失败标记,属短期可再抄凭据,ADR-0027);id 上游无稳定值,
 * 以热搜词本身充当。
 */
export function parseWeibo(html: string): PortedNewsItem[] {
  const $ = cheerio.load(html)
  const out: PortedNewsItem[] = []
  $('#pl_top_realtimehot table tbody tr')
    .slice(1)
    .each((_, row) => {
      const $row = $(row)
      const $link = $row
        .find('td.td-02 a')
        .filter((_, el) => {
          const href = $(el).attr('href')
          return !!(href && !href.includes('javascript:void(0);'))
        })
        .first()
      const title = $link.text().trim()
      const href = $link.attr('href')
      if (title && href) out.push({ id: title, title, url: `https://s.weibo.com${href}`, publishedAt: null })
    })
  return out
}

const fetchWeibo: NewsGetter = async (d) => {
  const url = 'https://s.weibo.com/top/summary?cate=realtimehot'
  return parseWeibo(
    await d.fetchText(url, FETCH_TIMEOUT, {
      headers: {
        // 上游源码自带 Chrome/119 UA + 游客 Cookie,照抄(newnow 注明出处 v5tech/weibo-trending-hot-search)
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
        Cookie:
          'SUB=_2AkMWIuNSf8NxqwJRmP8dy2rhaoV2ygrEieKgfhKJJRMxHRl-yT9jqk86tRB6PaLNvQZR6zYUcYVT1zSjoSreQHidcUq7',
        referer: url,
      },
    }),
  )
}

export default fetchWeibo
