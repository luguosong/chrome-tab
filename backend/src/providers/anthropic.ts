import type { ModelEvent } from 'chrome-tab-shared'
import { ANTHROPIC_BASELINE } from '../anthropicBaseline'
import { aliasIn, slugIn, MONTHS, type ProviderDef } from './def'

// ---- Anthropic release notes(研究 §3:主发布源;页面混有 SDK/平台功能条目,
//  须按明确模型名/ID 过滤——与智谱同用双条件归属)----

/** Anthropic release notes 一个条目(解析后的统一形态)。 */
export interface AnthropicNote {
  /** YYYY-MM-DD(日期标题归一化后,含 'October 3rd, 2024' 式序数后缀)。 */
  date: string
  /** 条目 Markdown 原文(链接文本/URL 一并保留,alias 在原文上词边界匹配)。 */
  text: string
  /** 条目内链接 URL(按出现序)。 */
  links: string[]
}

/** 'August 5, 2026' / 'October 3rd, 2024' → '2026-08-05' / '2024-10-03';非法 → null。 */
export function normalizeAnthropicDate(raw: string): string | null {
  const m = /^([A-Z][a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,\s*(\d{4})$/.exec(raw.trim())
  if (!m) return null
  const [, mon, day, y] = m
  const mo = MONTHS[mon!]
  if (mo === undefined) return null
  const d = Number(day)
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, d))
  if (date.getUTCMonth() !== Number(mo) - 1 || date.getUTCDate() !== d) return null
  return `${y}-${mo}-${String(d).padStart(2, '0')}`
}

/** Anthropic release notes Markdown → 条目数组。按 `### 日期标题` 分段(段名即信源日期),
 *  段内行首 `* ` 逐条提取文本与 `[label](url)` 链接;畸形日期段与空段跳过。 */
export function parseAnthropicReleases(md: string): AnthropicNote[] {
  const out: AnthropicNote[] = []
  const headings = [...md.matchAll(/^### (.+)$/gm)]
  for (let i = 0; i < headings.length; i++) {
    const date = normalizeAnthropicDate(headings[i]![1]!)
    if (date === null) continue
    const body = md.slice(headings[i]!.index! + headings[i]![0].length, headings[i + 1]?.index)
    for (const line of body.split('\n')) {
      if (!line.startsWith('* ')) continue
      const text = line.slice(2)
      const links = [...text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)].map((m) => m[1]!)
      out.push({ date, text, links })
    }
  }
  return out
}

/** 条目标题:首个英文句子的截断形态(release notes 条目无短标题,首句即最接近的概述)。 */
function anthropicNoteTitle(text: string): string {
  const firstSentence = text.split('. ')[0]!
  return firstSentence.length > 160 ? `${firstSentence.slice(0, 157)}…` : firstSentence
}

/**
 * release notes 条目 → (基线模型 officialId, 事件)。双条件归属与智谱同构:条目原文含
 * 基线 alias(词边界;「Claude Opus 4」不认领「Claude Opus 4.8」的条目)**且** 条目内
 * 存在链接命中基线 slug(路径尾边界)——SDK/平台功能条目与基线外型号(Mythos 等)因此
 * 天然跳过。kind 恒 'updated',与基线事件同 (模型,日期,信源) 的条目由 poll 跳过。
 */
export function matchAnthropicEvent(n: AnthropicNote): { officialId: string; event: Omit<ModelEvent, 'id'> } | null {
  for (const b of ANTHROPIC_BASELINE) {
    const aliasHit = b.matchAliases.some((a) => aliasIn(a, n.text))
    const link = n.links.find((u) => (b.matchSlugs ?? []).some((s) => slugIn(s, u)))
    if (aliasHit && link) {
      return {
        officialId: b.officialId,
        event: { kind: 'updated', occurredOn: n.date, title: anthropicNoteTitle(n.text), sourceUrl: link },
      }
    }
  }
  return null
}

/** Anthropic Claude Platform release notes(主发布源,研究 §3)。 */
export const ANTHROPIC_RELEASES_URL = 'https://platform.claude.com/docs/en/release-notes/overview.md'

/** Anthropic provider:双条件归属(与智谱同构);未认领条目以首链接/日期+原文前缀为线索键。 */
export const ANTHROPIC_DEF: ProviderDef<AnthropicNote> = {
  id: 'anthropic',
  label: 'Anthropic',
  urls: [ANTHROPIC_RELEASES_URL],
  parse: parseAnthropicReleases,
  matchEntry(n) {
    const hit = matchAnthropicEvent(n)
    if (hit !== null) return { hits: [hit], clues: [] }
    return {
      hits: [],
      clues: [
        {
          occurredOn: n.date,
          title: anthropicNoteTitle(n.text),
          sourceUrl: n.links[0] ?? ANTHROPIC_RELEASES_URL,
          modelKey: n.links[0] ?? `${n.date}|${n.text.slice(0, 80)}`,
        },
      ],
    }
  },
}
