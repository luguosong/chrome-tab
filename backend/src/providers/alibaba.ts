import { QWEN_BASELINE, QWEN_RELEASES_URL } from '../qwenBaseline'
import { clipFragment, type MatchedHit, type ParseResult, type ProviderDef, residualIdClues } from './def'

// ---- 阿里通义:百炼「模型上下架与更新」(研究 §3:主发布源 SSR 纯表格。解析器
//  原随 qwenBaseline 走(并行接入防撞车约定),ADR-0038 起归一为厂家 provider 文件)----

/** 首表一行(解析后的统一形态)。 */
export interface BailianRow {
  /** YYYY-MM-DD(时间列;表内日期均零填充,防御不补零形态)。 */
  date: string
  /** 模型 ID 单元格切分(一格可含主线+latest+快照多 ID,按空白切;相对路径 ID 含斜杠原样保留)。 */
  modelIds: string[]
  /** 功能说明原文(标签已剥、空白归一;多 ID 行为该族共用说明)。 */
  description: string
}

/** 单元格文本:剥中西文间距 span 与标签、还原实体、空白归一。 */
function cellText(cell: string): string {
  return cell
    .replace(/<span class="help-letter-space"><\/span>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 'YYYY-M-D' 零填充并回滚校验(实日期);非法 → null。 */
function normalizeBailianDate(raw: string): string | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw)
  if (!m) return null
  const [, y, mo, d] = m
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)))
  if (date.getUTCMonth() !== Number(mo) - 1 || date.getUTCDate() !== Number(d)) return null
  return `${y}-${mo!.padStart(2, '0')}-${d!.padStart(2, '0')}`
}

/**
 * 页面 HTML → 首表行数组。**只取第一个 `<table>`**(华北2 北京区;页面 10 张表 = 5 唯一
 * 表 × 2 拷贝 SSR+hydration,首表即全量北京区)。表头行为 `<th>` 无 `<td>` 自然跳过;
 * 列序固定 模型类型|时间|模型ID|功能说明,时间列过不了日期校验的行(结构变化)跳过。
 */
export function parseBailianReleases(html: string): ParseResult<BailianRow> {
  const table = /<table[^>]*>([\s\S]*?)<\/table>/.exec(html)?.[1]
  if (table === undefined) return { entries: [], skipped: [] }
  const out: BailianRow[] = []
  const skipped: string[] = []
  for (const tr of table.split(/<tr[^>]*>/).slice(1)) {
    const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => cellText(m[1]!))
    if (cells.length === 0) continue // 结构排除:表头 <th> 行(无 <td>)
    // 片段用归一 cells 拼接而非原始 tr:live 页首格含 help-letter-space span,原始 80
    // 字符截断会吃掉日期与模型 ID 格(评审修正)——归一文本四列全可见
    const frag = clipFragment(cells.join(' | '))
    if (cells.length < 4) {
      skipped.push(frag) // 意外跳过:数据行列数异常(表头为 0 格,此处必为错列)
      continue
    }
    const date = normalizeBailianDate(cells[1]!)
    if (date === null) {
      skipped.push(frag) // 意外跳过:时间列日期校验失败
      continue
    }
    const modelIds = cells[2]!.split(' ').filter(Boolean)
    if (modelIds.length === 0) {
      skipped.push(frag) // 意外跳过:模型 ID 格为空
      continue
    }
    out.push({ date, modelIds, description: cells[3]! })
  }
  return { entries: out, skipped }
}

/**
 * 表格行模型 ID → 基线 officialId。**精确命中优先返回**(「qwen3.7-flash」归自己,不被
 * 别的更长前缀抢走);否则取最长 `id.startsWith(alias + '-')` 前缀命中——快照/变体
 * (qwen3.7-max-2026-06-08、qwen-plus-latest)归家族行。无版本别名(qwen-plus 等)与
 * 百炼托管第三方模型(kimi-k3、ZHIPU/GLM-5.3、vidu/…)不在任何 alias 集,天然 null
 * ——这是「跟踪厂家」定义性约束(不认领非自家模型)。
 */
export function resolveQwenModelId(id: string): string | null {
  let best: string | null = null
  let bestLen = -1
  for (const b of QWEN_BASELINE) {
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

/**
 * 表格行 → 每个被认领模型一条事件(kind 恒 'updated',自动解析不猜语义;同格多 ID 命中
 * 同一行只产一条)。事件信源统一为主发布源页 URL,与基线事件 sourceUrl 同构——同
 * (模型,日期,信源) 的行由 poll 跳过(基线 api_available 已覆盖的上架行不补重复动态)。
 * ponytail: 同日同模型两条表格行会撞去重键只留一条(实测首表同日同行族归并一格;
 * 若上游出现同日同模型分格双公告,再升格内序号锚)。
 */
export function matchQwenEvents(rows: BailianRow[]): Array<MatchedHit> {
  const out: Array<MatchedHit> = []
  for (const r of rows) {
    const claimed = new Set<string>()
    for (const id of r.modelIds) {
      const officialId = resolveQwenModelId(id)
      if (officialId === null || claimed.has(officialId)) continue
      claimed.add(officialId)
      const title = r.description.length > 160 ? `${r.description.slice(0, 157)}…` : r.description
      out.push({
        officialId,
        event: { kind: 'updated', occurredOn: r.date, title, sourceUrl: QWEN_RELEASES_URL },
      })
    }
  }
  return out
}

/**
 * 通义 provider(表为滚动窗口,行翻走即失证——线索须当轮可见,2026-08-27 千问漏检
 * 教训)。未认领 ID(全未认领行与部分认领行的残余半边同构,含百炼托管第三方)
 * 每个 ID 一条线索,键 = 裸 ID(单 ID 行与旧整条键同形,多 ID 行不再拼串——拼串键
 * 与裸键并存会让基线收录部分成员后过渡期双行同现);title 为「ID:说明前缀」
 * 合成形态;`-latest` 引用别名不落残余(不另算模型)。
 */
export const ALIBABA_DEF: ProviderDef<BailianRow> = {
  id: 'alibaba',
  label: '通义',
  urls: [QWEN_RELEASES_URL],
  parse: parseBailianReleases,
  matchEntry(r) {
    return {
      hits: matchQwenEvents([r]),
      clues: residualIdClues(r.modelIds, resolveQwenModelId, {
        occurredOn: r.date,
        titleOf: () => r.description.slice(0, 60),
        sourceUrl: QWEN_RELEASES_URL,
      }),
    }
  },
}
