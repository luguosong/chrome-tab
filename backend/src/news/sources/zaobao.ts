import * as cheerio from 'cheerio'
import { decodeGb2312, parseBeijingSecond } from '../parse'
import { FETCH_TIMEOUT, newsHeaders, type NewsGetter, type PortedNewsItem } from './types'

/**
 * 联合早报(newnow server/sources/zaobao.ts 移植):第三方镜像站 zaochenbao.com,
 * gb2312 编码(响应按字节取回再转码);.pdt10 日期文本剥括号后按北京时间墙钟解析,
 * 解析失败该条降级 null。
 */
export function parseZaobao(html: string): PortedNewsItem[] {
  const $ = cheerio.load(html)
  const base = 'https://www.zaochenbao.com'
  const out: PortedNewsItem[] = []
  $('div.list-block>a.item').each((_, el) => {
    const a = $(el)
    const href = a.attr('href')
    const title = a.find('.eps')?.text()
    const date = a.find('.pdt10')?.text().replace(/[()]/g, '').replace(/-\s/g, ' ')
    if (href && title) {
      out.push({ url: base + href, title, id: href, publishedAt: date ? parseBeijingSecond(date) : null })
    }
  })
  return out
}

const fetchZaobao: NewsGetter = async (d) =>
  parseZaobao(
    decodeGb2312(await d.fetchBuffer('https://www.zaochenbao.com/realtime/', FETCH_TIMEOUT, newsHeaders())),
  )

export default fetchZaobao
