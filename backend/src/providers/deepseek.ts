import { DEEPSEEK_BASELINE, DEEPSEEK_UPDATES_URL } from '../deepseekBaseline'
import { aliasIn, clipFragment, isRealIsoDate, type MatchedHit, type ParseResult, type ProviderDef } from './def'

// ---- DeepSeek API Change Log(研究 §3:主发布源 HTML 无 RSS。解析器与匹配器随
//  厂家 provider 文件走——issues/07 期间「随基线文件走」是并行接入防撞车的临时
//  约定,ADR-0038 起归一为「一厂家一 provider 文件」)----

/** DeepSeek Change Log 一个小节(解析后的统一形态)。 */
export interface DeepSeekSection {
  /** YYYY-MM-DD(所在 `<h2 id="date-…">Date: YYYY-MM-DD` 日期段)。 */
  date: string
  /** 小节标题(h3 文本,官方条目名;HTML 实体已还原、锚点零宽字符已剥)。 */
  title: string
  /** 小节锚点 URL(事件信源;与基线事件 sourceUrl 同构拼串,同键去重对齐)。 */
  anchorUrl: string
}

/**
 * DeepSeek Change Log HTML → 小节数组。`<h2>` 分段、段首 `Date: YYYY-MM-DD`(实日期
 * 回滚校验)为该段日期;段内 `<h3 id="…">` 逐节提取标题(剥内嵌锚点标签/零宽字符、
 * 还原 HTML 实体——实测 2024-09-05 节标题含 `&amp;`)。非日期 h2 段(页首/侧栏)与
 * 无 id 的 h3 跳过。
 */
export function parseDeepSeekUpdates(html: string): ParseResult<DeepSeekSection> {
  const out: DeepSeekSection[] = []
  const skipped: string[] = []
  for (const part of html.split(/<h2[^>]*>/).slice(1)) {
    // 未补零日期归一接受(智谱/百炼上游实测产未补零形态,同源漂移不该在此蒸发——评审修正)
    const m = /^Date: (\d{4})-(\d{1,2})-(\d{1,2})/.exec(part)
    if (!m) continue // 结构排除:非日期 h2 段(页首/侧栏)
    const [, y, mo, d] = m
    const date = `${y}-${mo!.padStart(2, '0')}-${d!.padStart(2, '0')}`
    if (!isRealIsoDate(date)) {
      skipped.push(clipFragment(part.trim())) // 意外跳过:Date: 日期回滚校验失败
      continue
    }
    for (const h3 of part.matchAll(/<h3[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/h3>/g)) {
      const title = h3[2]!
        .replace(/<[^>]+>/g, '')
        .replace(/​/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .trim()
      if (title === '') {
        skipped.push(clipFragment(h3[0]!)) // 意外跳过:h3 有 id 但标题剥完为空
        continue
      }
      out.push({ date, title, anchorUrl: `${DEEPSEEK_UPDATES_URL}#${h3[1]}` })
    }
  }
  return { entries: out, skipped }
}

/**
 * Change Log 小节 → 基线模型命中数组(**可为多个**:同 xAI matchXaiEvent 口径——家族式
 * 标题「V4-Pro 与 V4-Flash …」同时命中两行,单返回会静默漏记半边)。归属**只用标题
 * 词边界**(标题即官方条目名、自证归属;正文混提他模型不可作证据——实测 2026-08-21
 * Vision-Exp 节正文提及「on par with DeepSeek-V4-Flash」,按正文归属会误记 V4-Flash)。
 * 别名 ID 标题段(deepseek-chat/reasoner/coder 的历史升级公告)与平台功能段(缓存
 * 技术、API 功能)无 alias 命中 → 待核验线索跳过,该史实由基线事件承载。kind 恒
 * 'updated',与基线事件同 (模型,日期,信源) 的小节由 poll 跳过。
 */
export function matchDeepSeekEvent(s: DeepSeekSection): Array<MatchedHit> {
  const out: Array<MatchedHit> = []
  for (const b of DEEPSEEK_BASELINE) {
    if (!b.matchAliases.some((a) => aliasIn(a, s.title))) continue
    out.push({
      officialId: b.officialId,
      event: { kind: 'updated', occurredOn: s.date, title: s.title, sourceUrl: s.anchorUrl },
    })
  }
  return out
}

/** DeepSeek provider:标题词边界匹配;未认领小节以锚点 URL 为线索键落待核验线索。 */
export const DEEPSEEK_DEF: ProviderDef<DeepSeekSection> = {
  id: 'deepseek',
  label: 'DeepSeek',
  urls: [DEEPSEEK_UPDATES_URL],
  parse: parseDeepSeekUpdates,
  matchEntry(s) {
    const matched = matchDeepSeekEvent(s)
    if (matched.length > 0) return { hits: matched, clues: [] }
    return {
      hits: [],
      clues: [{ occurredOn: s.date, title: s.title, sourceUrl: s.anchorUrl, modelKey: s.anchorUrl }],
    }
  },
}
