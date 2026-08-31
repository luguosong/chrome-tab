import type { Handler } from 'hono'
import type { AuthEnv } from './auth'
import { BadRequest, chromeHeaders, FETCH_TIMEOUT, fetchRes as prodFetchRes, TtlCache } from './common'

/**
 * 站点信息抓取(见 CONTEXT.md「站点信息」):GET /api/site-info?url=…
 * 新增/编辑「网站链接」表单的自动填充数据源——后端抓目标页 HTML,解析 <title> 与
 * <link rel~icon> 图标候选下发。TTL 缓存仅存成功结果(失败下次重试),不持久化;
 * 表单之外无消费方,图标最终形态仍由前端「派生 favicon + 图标覆盖」决定。
 * 取数经 fetchRes 底形态(要读 res.url 重定向落地;超时防挂起 + 非 2xx 抛,ADR-0045 补收)。
 */

export interface SiteInfoDto {
  title: string
  icons: string[]
}

const TTL_MS = 30 * 60 * 1000
/** 只解析开头一截:title/icon 声明都在 <head>,防超大页面整页解析。
 *  ponytail: 按字节截断,内联脚本/CSS 前置的超长 head 站点可能漏尾部候选;
 *  真实站点撞上再升级为按 </head> 定位或流式截断。 */
const MAX_HTML = 200_000

// ---- 解析(纯函数,Vitest 直测)----

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

/** 命名/数字实体解码;未知名原样保留 */
function decodeEntities(s: string): string {
  return s.replace(/&#(\d+);|&#x([0-9a-f]+);|&(\w+);/gi, (m, dec: string, hex: string, name: string) => {
    if (dec) return String.fromCodePoint(Number(dec))
    if (hex) return String.fromCodePoint(parseInt(hex, 16))
    return NAMED_ENTITIES[name.toLowerCase()] ?? m
  })
}

/** link 标签里的属性值(单双引号/HTML5 无引号写法均可);缺失/畸形返回 null */
function attr(tag: string, name: string): string | null {
  // 无引号分支:不含空白/引号/尖括号即认(HTML5 同口径;反引号极罕见,不单列)
  const m = tag.match(
    new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'<>]+))`, 'i'),
  )
  const v = m?.[1] ?? m?.[2] ?? m?.[3]
  return v === undefined ? null : v
}

/** HTML → {title, icons}。icons 为按页面 URL 解析成绝对地址、去重后的候选,文档序。 */
export function parseSiteInfo(html: string, baseUrl: string): SiteInfoDto {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  // 先剥内嵌标签再解码实体(实体解码出的 < > 不是标签,顺序反了会误删)
  const title = titleMatch
    ? decodeEntities(titleMatch[1].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()
    : ''
  const icons: string[] = []
  const seen = new Set<string>()
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = attr(tag, 'rel')
    if (!rel || !rel.trim().split(/\s+/).some((t) => /icon$/i.test(t))) continue
    const href = attr(tag, 'href')
    if (!href) continue
    try {
      const abs = new URL(href, baseUrl).toString()
      if (!seen.has(abs)) {
        seen.add(abs)
        icons.push(abs)
      }
    } catch {
      /* 畸形 href 跳过 */
    }
  }
  return { title, icons }
}

// ---- handler ----

export interface SiteInfoDeps {
  /** 依赖注入缝(测试不打真网);缺省即 common 原语 */
  fetchRes?: (url: string, timeoutMs: number, init?: RequestInit) => Promise<Response>
}

export function createSiteInfoHandler(deps: SiteInfoDeps = {}): Handler<AuthEnv> {
  const fetchRes = deps.fetchRes ?? prodFetchRes
  const cache = new TtlCache<SiteInfoDto>()
  return async (c) => {
    const raw = c.req.query('url') ?? ''
    // 信任边界:url 是用户输入的外呼目标,只放行 http(s)(挡 file: 等)。
    // ponytail: 单用户带鉴权的个人应用,不做私网 IP 黑名单;多租户时再补。
    let target: URL
    try {
      target = new URL(raw)
    } catch {
      throw new BadRequest('url 参数不是合法地址')
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      throw new BadRequest('url 仅支持 http(s)')
    }
    const key = target.toString()
    // mimosa-ignore 「站点信息」按已登录用户提交网址抓取是产品既定功能(CONTEXT.md),SSRF 面为已接受风险
    const cached = cache.get(key)
    if (cached) return c.json(cached)
    const res = await fetchRes(key, FETCH_TIMEOUT, {
      ...chromeHeaders({ accept: 'text/html' }),
      redirect: 'follow',
    })
    const html = (await res.text()).slice(0, MAX_HTML)
    // 重定向后以最终落地 URL 为基准解析相对地址(Response 合成时 url 为空,回落入参)
    const value = parseSiteInfo(html, res.url || key)
    cache.put(key, value, TTL_MS)
    return c.json(value)
  }
}
