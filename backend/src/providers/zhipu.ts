import type { ModelEvent } from 'chrome-tab-shared'
import { ZHIPU_BASELINE } from '../zhipuBaseline'
import { aliasIn, clipFragment, type ParseResult, type ProviderDef, slugIn } from './def'

// ---- 智谱新品发布页(研究 §3:主发布源;发布页 Markdown 的 `<Update>` 块)----

/** 智谱发布页一个更新块(解析后的统一形态)。 */
export interface ZhipuUpdate {
  /** YYYY-MM-DD(信源不补零的 label 归一化后)。 */
  date: string
  /** 块描述(announcement 标题,如「GLM-5.3 新一代旗舰模型上线」)。 */
  description: string
  /** 块内首个模型文档链接(相对路径已归一为绝对);无链接 → null。 */
  docUrl: string | null
}

/** '2026-8-19' / '2026-06-16' → '2026-08-19' / '2026-06-16';非法 → null。 */
export function normalizeZhipuDate(raw: string): string | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw.trim())
  if (!m) return null
  const [, y, mo, d] = m
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)))
  if (date.getUTCMonth() !== Number(mo) - 1 || date.getUTCDate() !== Number(d)) return null
  return `${y}-${mo!.padStart(2, '0')}-${d!.padStart(2, '0')}`
}

/** 智谱新品发布 Markdown → 更新块数组。结构化 `<Update>` 块逐个提取 label/description/块内首个链接;
 *  双 lookahead 锚定两属性、**次序无关**(上游调整属性序不致静默清零);畸形块跳过。 */
export function parseZhipuReleases(md: string): ParseResult<ZhipuUpdate> {
  const out: ZhipuUpdate[] = []
  const skipped: string[] = []
  const blockRe = /<Update\b(?=[^>]*label="([^"]*)")(?=[^>]*description="([^"]*)")[^>]*>([\s\S]*?)<\/Update>/g
  const blocks = [...md.matchAll(blockRe)]
  for (const m of blocks) {
    const date = normalizeZhipuDate(m[1]!)
    if (!date) {
      // 片段用已提取字段(label 前置):畸形 label 正是排障要看的内容,原始块截断会被
      // 前置长 description 推出 80 字符窗口(属性调序是双 lookahead 声称防御的动作)
      skipped.push(clipFragment(`${m[1]} ${m[2]}`)) // 意外跳过:块结构匹配但日期 label 畸形
      continue
    }
    // 块内首个 markdown 链接([**名称**](路径));相对路径(/cn/…)归一到 docs.bigmodel.cn
    const link = /\[[^\]]*\]\(([^)\s]+)\)/.exec(m[3]!)?.[1]
    const docUrl = link
      ? link.startsWith('/')
        ? `https://docs.bigmodel.cn${link}`
        : link
      : null
    out.push({ date, description: m[2]!, docUrl })
  }
  // 对账(评审修正):blockRe 双 lookahead 要求 label+description 同时在场——缺一或
  // 改名的块 matchAll 不到,其余块照常产出故零条目通道也不触发,发布内容整体不可见。
  // 成功匹配块的开标签起点 = blockRe match index,不在其中的 <Update 开标签即不可见块。
  const visible = new Set(blocks.map((m) => m.index))
  for (const tag of md.matchAll(/<Update\b[^>]*>/g)) {
    if (!visible.has(tag.index)) skipped.push(clipFragment(tag[0])) // 意外跳过:属性缺失或改名
  }
  return { entries: out, skipped }
}

/**
 * 更新块 → (基线模型 officialId, 事件)。仅双条件匹配的块产事件,kind 恒 'updated'
 * (自动解析不猜语义化事件类型;api_available 等语义类型只出自人工核验基线 events)。
 * 与基线事件同 (模型,日期,信源) 的块由轮询入库(runPoll → ingest 的 seen 过滤)跳过,不产重复动态。
 */
export function matchZhipuEvent(u: ZhipuUpdate): { officialId: string; event: Omit<ModelEvent, 'id'> } | null {
  const docUrl = u.docUrl
  if (docUrl === null) return null // 无链接无法核验归属 → 待核验线索,不生成动态
  for (const b of ZHIPU_BASELINE) {
    const aliasHit = b.matchAliases.some((a) => aliasIn(a, u.description))
    const slugHit = (b.matchSlugs ?? []).some((s) => slugIn(s, docUrl))
    if (aliasHit && slugHit) {
      const event: Omit<ModelEvent, 'id'> = {
        kind: 'updated',
        occurredOn: u.date,
        title: u.description,
        sourceUrl: docUrl,
      }
      return { officialId: b.officialId, event }
    }
  }
  return null
}

/** 智谱新品发布页(主发布源,研究 §3)。 */
export const ZHIPU_RELEASES_URL = 'https://docs.bigmodel.cn/cn/update/new-releases.md'

/** 智谱 provider:双条件归属(alias 词边界 + 文档链接 slug);未认领块以文档链接/日期+描述为线索键。 */
export const ZHIPU_DEF: ProviderDef<ZhipuUpdate> = {
  id: 'zhipu',
  label: '智谱',
  urls: [ZHIPU_RELEASES_URL],
  parse: parseZhipuReleases,
  matchEntry(u) {
    const hit = matchZhipuEvent(u)
    if (hit !== null) return { hits: [hit], clues: [] }
    return {
      hits: [],
      clues: [
        {
          occurredOn: u.date,
          title: u.description,
          sourceUrl: u.docUrl ?? ZHIPU_RELEASES_URL,
          modelKey: u.docUrl ?? `${u.date}|${u.description}`,
        },
      ],
    }
  },
}
