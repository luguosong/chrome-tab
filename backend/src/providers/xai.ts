import { XAI_BASELINE } from '../xaiBaseline'
import { aliasIn, clipFragment, MONTHS, type MatchedHit, type ParseResult, type ProviderDef } from './def'

// ---- xAI 发布流(研究 §3:主发布源;`## 月份` 标题仅月份粒度,条目 `### ` 自带标题)----

/** xAI 发布流一个条目(解析后的统一形态)。 */
export interface XaiReleaseEntry {
  /** YYYY-MM(信源只有月份粒度;事件锚定当月 1 日)。 */
  yearMonth: string
  /** 条目标题(`### ` 行原文,即官方条目名——归属匹配只用标题,见 matchXaiEvent)。 */
  title: string
  /** 正文首个链接(相对路径已归一为绝对);无 → null。 */
  linkUrl: string | null
}

/**
 * xAI 发布流 Markdown → 条目数组。`## <Month>[ <YYYY>]` 月份标题分段、段内 `### ` 条目
 * 逐个提取标题与正文首个链接。当年月份标题**不带年份**(2026-08-25 实抓口径),首个带
 * 年份标题之前按 currentYear(生产传当年,测试传固定值保持确定性)、其后依显式年份;
 * **无年份月份大于 currentMonth 时归上一年**(评审修正:元旦窗口里上一年未补年份的
 * 旧段会错记新年份,产未来日期事件且去重键永不同、双行不愈——12 月底挂次年 1 月
 * 无年份标题的边界仍错,那种场景上游显式带年份的可能性高,ponytail 接受)。
 * 非月份 `##` 段下的条目跳过;月份段之前的散条目跳过(均结构排除);**带四位年份但
 * 月份词不识的标题**(如 `## Sept 2026` 缩写漂移)落意外跳过——年份后缀是无猜的
 * 「这是月份标题」结构证据,整段丢弃须可观察(评审修正,ADR-0052)。
 */
export function parseXaiReleaseNotes(
  md: string,
  currentYear: number = new Date().getFullYear(),
  currentMonth: number = new Date().getUTCMonth() + 1,
): ParseResult<XaiReleaseEntry> {
  const out: XaiReleaseEntry[] = []
  const skipped: string[] = []
  let year: number | null = null
  let yearMonth: string | null = null
  let title: string | null = null
  let body: string[] = []
  const flush = () => {
    if (yearMonth !== null && title !== null) {
      const link = /\[[^\]]*\]\(([^)\s]+)\)/.exec(body.join('\n'))?.[1]
      out.push({
        yearMonth,
        title,
        linkUrl: link ? (link.startsWith('/') ? `https://docs.x.ai${link}` : link) : null,
      })
    }
    title = null
    body = []
  }
  for (const line of md.split('\n')) {
    const month = /^## ([A-Z][a-z]+)(?: (\d{4}))?$/.exec(line)
    if (month) {
      flush()
      const mo = MONTHS[month[1]!]
      if (mo === undefined) {
        if (month[2] !== undefined) skipped.push(clipFragment(line.trim())) // 意外跳过:带年份但月份词不识
        yearMonth = null
        continue
      }
      if (month[2] !== undefined) year = Number(month[2])
      yearMonth = `${year ?? (Number(mo) > currentMonth ? currentYear - 1 : currentYear)}-${mo}`
      continue
    }
    if (line.startsWith('### ')) {
      flush()
      title = line.slice(4).trim()
      continue
    }
    if (title !== null) body.push(line)
  }
  flush()
  return { entries: out, skipped }
}

/**
 * 发布流条目 → 基线模型命中数组(**可为多个**:家族条目「Grok 4.20 and Grok 4.20
 * Multi-agent are live」同时命中两行)。归属只用标题词边界——xAI 条目标题即官方条目
 * 名、自证归属,与智谱/Anthropic 的双条件不同(其正文链接常指向能力文档而非模型页,
 * 不能作 slug 证据)。kind 恒 'updated',occurredOn 锚定当月 1 日(信源月份粒度);
 * 与基线事件同 (模型,日期,信源) 的条目由 poll 跳过。
 */
export function matchXaiEvent(e: XaiReleaseEntry): Array<MatchedHit> {
  const out: Array<MatchedHit> = []
  for (const b of XAI_BASELINE) {
    if (!b.matchAliases.some((a) => aliasIn(a, e.title))) continue
    out.push({
      officialId: b.officialId,
      event: { kind: 'updated', occurredOn: `${e.yearMonth}-01`, title: e.title, sourceUrl: e.linkUrl ?? XAI_RELEASES_URL },
    })
  }
  return out
}

/** xAI 发布流(主发布源,研究 §3;公共缓存约 1 小时,轮询节奏 6h 不短于缓存)。 */
export const XAI_RELEASES_URL = 'https://docs.x.ai/developers/release-notes.md'

/** xAI provider:标题词边界归属(月份粒度事件锚定当月 1 日);未认领条目以首链接/标题为线索键。 */
export const XAI_DEF: ProviderDef<XaiReleaseEntry> = {
  id: 'xai',
  label: 'xAI',
  urls: [XAI_RELEASES_URL],
  parse: parseXaiReleaseNotes,
  matchEntry(e) {
    const matched = matchXaiEvent(e)
    if (matched.length > 0) return { hits: matched, clues: [] }
    return {
      hits: [],
      clues: [
        {
          occurredOn: `${e.yearMonth}-01`,
          title: e.title,
          sourceUrl: e.linkUrl ?? XAI_RELEASES_URL,
          modelKey: e.linkUrl ?? e.title,
        },
      ],
    }
  },
}
