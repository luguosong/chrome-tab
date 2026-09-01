import { OPENAI_BASELINE, OPENAI_CHANGELOG_PAGE_URL, openaiChangelogAnchor } from '../openaiBaseline'
import { clipFragment, isRealIsoDate, MONTHS, type MatchedHit, type ParseResult, type ProviderDef, residualIdClues } from './def'

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
/** 日标题月份缩写词表(全名前三字母;实抓口径 `### Aug 21`,fixture 同证——日标题
 *  是「月缩写 日」形态,与上层 `## August, 2026` 同月):`### Foo 5` 这类同形非月份
 *  词不再被当日标题(评审修正:原只查 1–31 范围,任意三字母词+数字都沿用旧月份静默
 *  错记日期)。 */
const MONTH_ABBREVS = new Set(Object.keys(MONTHS).map((n) => n.slice(0, 3)))

export function parseOpenAIChangelog(md: string): ParseResult<OpenAIChangelogEntry> {
  const out: OpenAIChangelogEntry[] = []
  const skipped: string[] = []
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
      // 词表校验 + 按月回滚(isRealIsoDate 覆盖 1–31 范围):`### Foo 5` 与 `### Sep 31`(9 月
      // 无 31 日)都清空日期上下文——其下类型行落意外跳过,不再沿用旧月份静默错记日期
      const d = dayHeading !== null ? String(Number(dayHeading[2])).padStart(2, '0') : ''
      day =
        dayHeading !== null && MONTH_ABBREVS.has(dayHeading[1]!) && year !== null && month !== null
          ? (isRealIsoDate(`${year}-${month}-${d}`) ? d : null)
          : null
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
      } else {
        skipped.push(clipFragment(line.trim())) // 意外跳过:类型行遇空日期上下文
      }
      continue
    }
    if (entry !== null && entry.firstLine === '' && line.trim() !== '') entry.firstLine = line.trim()
  }
  flush()
  return { entries: out, skipped }
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
 * OpenAI provider:`Model:` 字段精确/前缀匹配。无 `Model:` 字段的平台/SDK 条目非
 * 模型线索,不落;其余条目(全未认领与部分认领同构)每个未被认领的 ID 一条线索
 * (键 = 裸 ID,`-latest` 移动别名不算——CONTEXT:latest 只是引用方式,不另算模型)。
 * 全未认领不再用「日期+ID 串」整条键:整条键与裸键并存会让同一模型在基线收录
 * 部分成员后的过渡期(旧整条行 7 天滚出前)双行同现。
 */
export const OPENAI_DEF: ProviderDef<OpenAIChangelogEntry> = {
  id: 'openai',
  label: 'OpenAI',
  urls: [OPENAI_CHANGELOG_URL],
  parse: parseOpenAIChangelog,
  matchEntry(e) {
    // 无 `Model:` 字段的平台/SDK 条目非模型线索,不落
    if (e.models.length === 0) return { hits: [], clues: [] }
    const title = openaiEntryTitle(e.firstLine !== '' ? e.firstLine : e.typeLine)
    return {
      hits: matchOpenAIEvents([e]),
      clues: residualIdClues(e.models, resolveOpenAIModelId, {
        occurredOn: e.date,
        titleOf: () => title,
        sourceUrl: openaiChangelogAnchor(e.date),
      }),
    }
  },
}
