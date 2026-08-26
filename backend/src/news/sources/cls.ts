import { normalizeSecond } from '../parse'
import { clsSignedQuery } from '../parse'
import { FETCH_TIMEOUT, newsHeaders, type NewsGetter, type PortedNewsItem } from './types'

/**
 * 财联社电报(newnow server/sources/cls/index.ts 的 telegraph 子源移植):接口需
 * 签名(见 parse.ts clsSignedQuery,原出处 RSSHub);ctime 为秒级时间戳;广告条目剔除。
 */
export function parseCls(json: unknown): PortedNewsItem[] {
  const roll = (json as { data?: { roll_data?: unknown } })?.data?.roll_data
  if (!Array.isArray(roll)) return []
  const out: PortedNewsItem[] = []
  for (const k of roll as Array<Record<string, unknown>>) {
    if (k['is_ad'] === 1) continue
    const id = k['id'] === undefined ? '' : String(k['id'])
    const title = typeof k['title'] === 'string' && k['title'] ? k['title'] : typeof k['brief'] === 'string' ? k['brief'] : ''
    if (id && title) {
      out.push({
        id,
        title,
        url: `https://www.cls.cn/detail/${id}`,
        publishedAt: normalizeSecond(k['ctime']),
      })
    }
  }
  return out
}

const fetchCls: NewsGetter = async (d) => {
  const qs = clsSignedQuery({ last_time: String(Math.floor(Date.now() / 1000)), refresh_type: '1', rn: '30' })
  return parseCls(
    JSON.parse(
      await d.fetchText(`https://www.cls.cn/v1/roll/get_roll_list?${qs}`, FETCH_TIMEOUT, newsHeaders({ referer: 'https://www.cls.cn/telegraph' })),
    ),
  )
}

export default fetchCls
