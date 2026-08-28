import type { ModelEvent } from 'chrome-tab-shared'
import { KIMI_BASELINE } from '../kimiBaseline'
import { aliasIn, type ProviderDef } from './def'

// ---- 月之暗面资讯/Blog(研究 §3:商业模型用资讯、研究/开放权重用 Blog,两页
//  均无文档化 RSS——按文章 URL 去重,研究 §6.6;页面为同构 Next.js 卡片列表)----

/** 月之暗面资讯/Blog 一篇文章卡片(解析后的统一形态)。 */
export interface KimiArticle {
  /** 绝对 URL(相对链接归一到 www.kimi.com;研究口径:按文章 URL 去重)。 */
  url: string
  /** 官方文章标题(卡片锚 aria-label,即 card-title 原文)。 */
  title: string
  /** YYYY-MM-DD(卡片日期文本,页面统一 ISO 格式)。 */
  date: string
}

/**
 * 资讯/Blog 页 HTML → 文章卡片数组。覆盖整卡的锚点(`<a href aria-label
 * class="absolute inset-0…">`)到下一锚点之间为一个卡片窗口:标题取锚点
 * aria-label,日期取 card-title **之后**的首个 ISO 日期文本——不能取窗口内首个
 * 日期,卡片头图 URL 常含与发布日不同的上传日期(实测 08-11 上传的头图配 07-27
 * 文章)。无日期卡跳过;同 URL 卡(头图卡与列表卡重复)只留首个;锚点缺失
 * (上游改版)自然产零卡 → runPoll 上游改版口径。
 */
export function parseKimiArticles(html: string): KimiArticle[] {
  const out: KimiArticle[] = []
  const seen = new Set<string>()
  const anchors = [
    ...html.matchAll(/<a href="([^"]+)" aria-label="([^"]+)" class="absolute inset-0[^"]*"/g),
  ]
  for (let i = 0; i < anchors.length; i++) {
    const [, href, label] = anchors[i]!
    const end = anchors[i + 1]?.index
    const cardWindow = html.slice(anchors[i]!.index! + anchors[i]![0].length, end)
    const titlePos = cardWindow.indexOf('card-title')
    if (titlePos < 0) continue
    const date = /20\d{2}-\d{2}-\d{2}/.exec(cardWindow.slice(titlePos))?.[0]
    if (date === undefined) continue
    const url = href!.startsWith('/') ? `https://www.kimi.com${href}` : href!
    if (seen.has(url)) continue
    seen.add(url)
    out.push({ url, title: label!, date })
  }
  return out
}

/**
 * 资讯/Blog 文章 → (基线模型 officialId, 事件)。归属只用标题词边界(文章标题即
 * 官方标题、自证归属,同 xAI 口径——正文链接常指向 GitHub/外部仓,不能作 slug
 * 证据)。**最长 alias 优先**:「Kimi K2 Thinking」标题同时命中「Kimi K2」与
 * 「Kimi K2 Thinking」,取更长(更具体)的归属。kind 恒 'updated',与基线事件同
 * (模型,日期,信源) 的文章由 poll 跳过——基线事件的信源即官方文章 URL。
 */
export function matchKimiEvent(a: KimiArticle): { officialId: string; event: Omit<ModelEvent, 'id'> } | null {
  let best: { officialId: string; alias: string } | null = null
  for (const b of KIMI_BASELINE) {
    for (const alias of b.matchAliases) {
      if (aliasIn(alias, a.title) && (best === null || alias.length > best.alias.length)) {
        best = { officialId: b.officialId, alias }
      }
    }
  }
  if (best === null) return null
  return {
    officialId: best.officialId,
    event: { kind: 'updated', occurredOn: a.date, title: a.title, sourceUrl: a.url },
  }
}

/** 月之暗面资讯(商业模型发布,研究 §3;无文档化 RSS,按文章 URL 去重)。 */
export const KIMI_NEWS_URL = 'https://www.kimi.com/news'
/** 月之暗面 Blog(研究/开放权重发布,研究 §3;同上按文章 URL 去重)。 */
export const KIMI_BLOG_URL = 'https://www.kimi.com/en/blog/'

/**
 * 月之暗面 provider:资讯+Blog **两页独立取数**(runPoll 的 urls 多项语义即为此家
 * 而设)。线索恒空:两页为文章流,非模型条目为主(线索即洪水);信源不滚动,
 * 漏检可事后核页。
 */
export const MOONSHOT_DEF: ProviderDef<KimiArticle> = {
  id: 'moonshot',
  label: '月之暗面',
  urls: [KIMI_NEWS_URL, KIMI_BLOG_URL],
  parse: parseKimiArticles,
  matchEntry(a) {
    const hit = matchKimiEvent(a)
    return { hits: hit !== null ? [hit] : [], clue: null }
  },
}
