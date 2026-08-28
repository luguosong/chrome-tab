import { OPENAI_BASELINE, OPENAI_CHANGELOG_PAGE_URL, openaiChangelogAnchor } from '../openaiBaseline'
import { MONTHS, type MatchedHit, type ProviderDef } from './def'

// ---- OpenAI API changelog(研究 §3:主发布源。与别家不同,条目类型行自带
//  `Model: id` 结构化字段,归属无需双条件猜测——精确 ID 匹配 + 最长前缀快照归族)----

/** OpenAI API changelog(主发布源;.md 形式直抓,锚点用人类可读页 URL——基址出自 openaiBaseline 单一事实源)。 */
export const OPENAI_CHANGELOG_URL = `${OPENAI_CHANGELOG_PAGE_URL}.md`

/** changelog 一个条目(解析后的统一形态)。 */
export interface OpenAIChangelogEntry {
  /** YYYY-MM-DD(`## Month, YYYY` 月标题与 `### Mon DD` 日标题两级合成)。 */
  date: string
  /** 条目类型行原文(Feature/Update/Announcement/Fix…)。 */
  typeLine: string
  /** 类型行声明的模型 ID(changelog 用精确 API ID,含日期快照与移动别名)。 */
  models: string[]
  /** 正文首行(自动解析事件的标题;无正文 → 空串)。 */
  firstLine: string
}

/** changelog Markdown → 条目数组。月标题定年月、日标题定日;类型行(Feature/Update/…
 *  开头)起一条,正文首行为标题;无日期上下文或畸形日期下的条目跳过;不认识的
 *  `##`/`###` 标题保守清空日期上下文(实测 156 个日标题全部规整,此分支为防线)。 */
export function parseOpenAIChangelog(md: string): OpenAIChangelogEntry[] {
  const out: OpenAIChangelogEntry[] = []
  let year: string | null = null
  let month: string | null = null
  let day: string | null = null
  let entry: OpenAIChangelogEntry | null = null
  const flush = () => {
    if (entry !== null) out.push(entry)
    entry = null
  }
  for (const line of md.split('\n')) {
    if (line.startsWith('## ')) {
      flush()
      const monthHeading = /^## ([A-Z][a-z]+), (\d{4})\s*$/.exec(line)
      year = monthHeading?.[2] ?? null
      month = (monthHeading !== null ? MONTHS[monthHeading[1]!] : null) ?? null
      day = null
      continue
    }
    if (line.startsWith('### ')) {
      flush()
      const dayHeading = /^### ([A-Z][a-z]{2}) (\d{1,2})\s*$/.exec(line)
      const d = dayHeading !== null ? Number(dayHeading[2]) : NaN
      day = month !== null && d >= 1 && d <= 31 ? String(d).padStart(2, '0') : null
      continue
    }
    if (/^(Feature|Update|Announcement|Fix|Deprecation|Breaking change)\b/.test(line)) {
      if (year !== null && month !== null && day !== null) {
        flush()
        entry = {
          date: `${year}-${month}-${day}`,
          typeLine: line.trim(),
          models: [...line.matchAll(/Model: ([a-zA-Z0-9._-]+)/g)].map((m) => m[1]!),
          firstLine: '',
        }
      }
      continue
    }
    if (entry !== null && entry.firstLine === '' && line.trim() !== '') entry.firstLine = line.trim()
  }
  flush()
  return out
}

/**
 * 条目模型 ID → 基线 officialId。**精确 alias 命中优先返回**(「gpt-5.2-codex」归自己,
 * 不被「gpt-5.2」前缀认领);否则取最长 `id.startsWith(alias + '-')` 前缀命中——日期
 * 快照(gpt-image-2-2026-04-21、gpt-4o-mini-transcribe-2025-12-15)归家族行;移动别名
 * (chat-latest、daybreak-*-latest、gpt-5.x-chat-latest)不在基线,天然返回 null。
 */
export function resolveOpenAIModelId(id: string): string | null {
  let best: string | null = null
  let bestLen = -1
  for (const b of OPENAI_BASELINE) {
    for (const a of b.matchAliases) {
      if (a === id) return b.officialId
      if (id.startsWith(`${a}-`) && a.length > bestLen) {
        best = b.officialId
        bestLen = a.length
      }
    }
  }
  return best
}

/** 条目标题:正文首行,超长截断(changelog 无短标题,首句即最接近的概述)。 */
function openaiEntryTitle(firstLine: string): string {
  return firstLine.length > 160 ? `${firstLine.slice(0, 157)}…` : firstLine
}

/**
 * changelog 条目 → 每个被认领模型一条事件(kind 恒 'updated',自动解析不猜语义;
 * 同条目多个 ID 命中同一行只产一条)。与基线事件同 (模型,日期,锚点) 的条目由
 * poll 跳过——基线 api_available 等语义事件在库时不补 'updated' 重复行。
 * ponytail: 锚点为日粒度,同日同模型两条公告会撞去重键只留一条(实测 changelog
 * 同日多公告均为不同模型/无模型条目;若上游出现同日同模型双公告,再升条目序号锚)。
 */
export function matchOpenAIEvents(
  entries: OpenAIChangelogEntry[],
): Array<MatchedHit> {
  const out: Array<MatchedHit> = []
  for (const e of entries) {
    if (e.models.length === 0) continue
    const anchor = openaiChangelogAnchor(e.date)
    const claimed = new Set<string>()
    for (const id of e.models) {
      const officialId = resolveOpenAIModelId(id)
      if (officialId === null || claimed.has(officialId)) continue
      claimed.add(officialId)
      out.push({
        officialId,
        event: {
          kind: 'updated',
          occurredOn: e.date,
          title: openaiEntryTitle(e.firstLine !== '' ? e.firstLine : e.typeLine),
          sourceUrl: anchor,
        },
      })
    }
  }
  return out
}

/**
 * OpenAI provider:`Model:` 字段精确/前缀匹配。线索只落**全部模型 ID 未被认领**的
 * 条目;无 `Model:` 字段的平台/SDK 条目非模型线索,不落。
 */
export const OPENAI_DEF: ProviderDef<OpenAIChangelogEntry> = {
  id: 'openai',
  label: 'OpenAI',
  urls: [OPENAI_CHANGELOG_URL],
  parse: parseOpenAIChangelog,
  matchEntry(e) {
    // 无 `Model:` 字段的平台/SDK 条目非模型线索,不落
    if (e.models.length === 0) return { hits: [], clue: null }
    const hits = matchOpenAIEvents([e])
    if (hits.length > 0) return { hits, clue: null }
    return {
      hits: [],
      clue: {
        occurredOn: e.date,
        title: openaiEntryTitle(e.firstLine !== '' ? e.firstLine : e.typeLine),
        sourceUrl: openaiChangelogAnchor(e.date),
        modelKey: `${e.date}|${e.models.join('+')}`,
      },
    }
  },
}
