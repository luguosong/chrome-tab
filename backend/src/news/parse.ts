import { createHash } from 'node:crypto'
import { XMLParser } from 'fast-xml-parser'

/**
 * 源解析共享小件(ADR-0027:newsnow 源定义移植的本地化适配层)——dayjs/ofetch/
 * iconv-lite/rss2json 全部以 Node 内置 + 既有依赖替代,失败一律 null 降级
 * (publishedAt 本就可空,解析不炸抓取)。纯函数,fixture 测试见 sources.test.ts。
 */

/** 秒级时间戳;启发式归一:>1e12 视为毫秒、>1e9 视为秒,其余视为无效。 */
export function normalizeSecond(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n) || n <= 0) return null
  if (n > 1e12) return Math.floor(n / 1000)
  if (n > 1e9) return Math.floor(n)
  return null
}

/** ISO/常见绝对时间文本 → unix 秒;失败 null。 */
export function parseAbsoluteSecond(text: string): number | null {
  const t = Date.parse(text)
  return Number.isFinite(t) ? Math.floor(t / 1000) : null
}

/**
 * 北京时间墙钟文本 → unix 秒。支持「YYYY-MM-DD HH:mm[:ss]」(参考消息 publishTime)
 * 与「YYYY-MM-DD HH:mm」(联合早报,日期可能带括号,由调用方先剥)。
 */
export function parseBeijingSecond(text: string): number | null {
  const m = /(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(text)
  if (!m) return null
  const [, y, mo, d, h, mi, s] = m
  const t = Date.parse(`${y}-${mo}-${d}T${h!.padStart(2, '0')}:${mi}:${s ?? '00'}+08:00`)
  return Number.isFinite(t) ? Math.floor(t / 1000) : null
}

/**
 * 中文相对时间 → unix 秒(nownow parseRelativeDate 的实用子集)。覆盖源页面实际
 * 形态:「刚刚」「N秒/N分钟/N小时/N天前」「今天/昨天 HH:MM」(北京时间);不可解析
 * → null。now 可注入(测试)。
 */
export function parseRelativeSecond(text: string, now: number = Date.now()): number | null {
  const s = text.trim().replace(/\s+/g, ' ')
  if (/^刚刚$/.test(s)) return Math.floor(now / 1000)
  if (/前$/.test(s)) {
    // 单/复合相对量词:「10分钟前」「2小时14分钟前」——逐单元累加
    const unit: Record<string, number> = { 秒: 1, 分钟: 60, 分: 60, 小时: 3600, 时: 3600, 天: 86400 }
    let sec = 0
    let matched = false
    for (const m of s.slice(0, -1).matchAll(/(\d+)\s*(秒|分钟|分|小时|时|天)/g)) {
      sec += Number(m[1]) * (unit[m[2]] ?? 0)
      matched = true
    }
    if (matched) return Math.floor(now / 1000) - sec
  }
  const day = /^(今天|昨天)\s*(\d{1,2}):(\d{2})$/.exec(s)
  if (day) {
    // 北京时间墙钟:now+8h 后取 UTC 分量即北京日期,再回退 8h 构造
    const bj = new Date(now + 8 * 3600_000)
    const base = Date.UTC(bj.getUTCFullYear(), bj.getUTCMonth(), bj.getUTCDate(), Number(day[2]), Number(day[3]))
    return Math.floor((base - 8 * 3600_000 - (day[1] === '昨天' ? 86400_000 : 0)) / 1000)
  }
  return null
}

/** gb2312 字节流 → UTF-8 文本(联合早报;Node TextDecoder 内置该编码,免 iconv-lite)。 */
export function decodeGb2312(buffer: ArrayBuffer): string {
  return new TextDecoder('gb2312').decode(buffer)
}

/**
 * 财联社接口签名(newnow cls/utils.ts 复刻,原出处 RSSHub):参数按 key 排序后
 * querystring,先 SHA-1 再 MD5,作为 sign 追加。返回拼好 sign 的完整 querystring。
 */
export function clsSignedQuery(params: Record<string, string>): string {
  const sp = new URLSearchParams({ appName: 'CailianpressWeb', os: 'web', sv: '7.7.5', ...params })
  sp.sort()
  const sha1 = createHash('sha1').update(sp.toString()).digest('hex')
  sp.append('sign', createHash('md5').update(sha1).digest('hex'))
  return sp.toString()
}

// ── RSS / Atom(newnow defineRSSSource 的本地替代;fast-xml-parser 已有依赖)──────

export interface RssItem {
  id: string
  title: string
  url: string
  publishedAt: number | null
}

const xml = new XMLParser({ ignoreAttributes: false })

/** RSS 2.0(rss>channel>item)与 Atom(feed>entry)统一解析;空/畸形 → 空数组。 */
export function parseRssItems(raw: string): RssItem[] {
  let doc: unknown
  try {
    doc = xml.parse(raw)
  } catch {
    return []
  }
  const out: RssItem[] = []
  const push = (title: unknown, url: unknown, id: unknown, date: unknown) => {
    const t = typeof title === 'string' ? title : ''
    const u = typeof url === 'string' && url ? url : ''
    if (t && u) {
      out.push({
        id: typeof id === 'string' && id ? id : u,
        title: t,
        url: u,
        publishedAt: typeof date === 'string' ? parseAbsoluteSecond(date) : null,
      })
    }
  }
  const rssItems = (doc as { rss?: { channel?: { item?: unknown } } })?.rss?.channel?.item
  for (const it of Array.isArray(rssItems) ? rssItems : rssItems ? [rssItems] : []) {
    const rec = it as Record<string, unknown>
    push(rec['title'], rec['link'], rec['guid'], rec['pubDate'])
  }
  if (out.length) return out
  const entries = (doc as { feed?: { entry?: unknown } })?.feed?.entry
  for (const it of Array.isArray(entries) ? entries : entries ? [entries] : []) {
    const rec = it as Record<string, unknown>
    const links = rec['link']
    const linkList = (Array.isArray(links) ? links : links ? [links] : []) as Array<Record<string, unknown>>
    const alt = linkList.find((l) => l['@_rel'] === 'alternate' || linkList.length === 1)?.['@_href']
    push(rec['title'], alt, rec['id'], rec['published'] ?? rec['updated'])
  }
  return out
}
