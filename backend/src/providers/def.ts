import type { ModelEvent, ModelProviderId } from 'chrome-tab-shared'

/**
 * 「跟踪厂家」的 provider 定义(CONTEXT.md「跟踪厂家」;ADR-0038):一个厂家与取数
 * 相关的全部差异——信源 URL、确定性解析器、单条目分派(命中为事件,未中为待核验
 * 线索)——打包为一份 ProviderDef;取数骨架(零条目判改版/循环收集/幂等入库/标陈旧/
 * 多页失败聚合)由 ModelTrackingService.runPoll 统一持有,不随厂家复制。
 */

/** 一条被基线认领的事件(officialId 指向基线行;入库时换 model_archive.id)。 */
export type MatchedHit = { officialId: string; event: Omit<ModelEvent, 'id'> }

/** 待核验线索(解析出但基线未认领的条目;ADR-0025「跳过待核验」的可见形态)。 */
export interface PendingClue {
  occurredOn: string
  title: string
  sourceUrl: string
  /** provider 内条目唯一键(文档链接/模型ID串),upsert 幂等去重。 */
  modelKey: string
}

/**
 * 单条目分派结果:命中 → 事件(家族式条目「Grok 4.20 and Grok 4.20 Multi-agent
 * are live」可多条);未认领信号 → 待核验线索(可多条:整条未认领一条,或部分认领
 * 条目每个残余 ID 一条;空数组 = 不落线索,如月暗文章流、无 `Model:` 字段的平台
 * 条目)。
 */
export interface MatchEntryResult {
  hits: MatchedHit[]
  clues: PendingClue[]
}

/**
 * 一个跟踪厂家的差异面。泛型 E 是该家解析后的条目形态;注册表以
 * ProviderDef<unknown> 存放(matchEntry 为方法语法,TS 方法双变使具体条目形态
 * 可存入),runPoll 经此擦除形态统一巡走。
 */
export interface ProviderDef<E> {
  id: ModelProviderId
  /** 中文厂名家(cron 失败日志用,与既有日志格式对齐)。 */
  label: string
  /** 信源 URL(月之暗面为资讯+Blog 两页,其余单页)。 */
  urls: string[]
  /** 信源原文 → 条目+意外跳过;零条目由 runPoll 统一判「上游改版」,skipped 非空
   *  由 runPoll 统一 warn(CONTEXT「意外跳过」,ADR-0052)。 */
  parse: (md: string) => ParseResult<E>
  /** 单条目分派(见 MatchEntryResult)。 */
  matchEntry(e: E): MatchEntryResult
}

/**
 * parse 的返回:条目 + **意外跳过**片段(ADR-0052)。skipped 只计实抓口径之外的
 * 形态(畸形日期/错列/剥空标题),页面正常构成(**结构排除**:表头、非条目行、
 * 同 URL 重复卡)不计——空数组是全网常态基线,非空即上游漂移信号。
 */
export interface ParseResult<E> {
  entries: E[]
  /** 意外跳过片段(原始原文,clipFragment 截断;排障对回上游原页)。 */
  skipped: string[]
}

/** 意外跳过片段:截 80 字符,按码点切(Array.from 防代理对拦腰截断出孤立代理项)。
 *  片段内容各家取「排障关键可见」的形态:跳过点在块/行开头用原始原文,窗口开头是
 *  噪音标签的(通义表格行/智谱属性块)用已提取字段合成,关键字段前置(防截尾丢失)。 */
export const clipFragment = (raw: string): string => {
  const cps = Array.from(raw)
  return cps.length > 80 ? `${cps.slice(0, 80).join('')}…` : raw
}

/** 'YYYY-MM-DD' 是实日期(回滚校验,`2026-13-45`/`2026-02-30` 拒收)——月暗卡日期
 *  与 DeepSeek 段日期共用(单一实现防漂移;各 normalize*Date 是归一+校验复合体,
 *  形态不同不合并)。 */
export const isRealIsoDate = (s: string): boolean => {
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

// ---- 匹配底座(多家共享的词边界/slug/月份判定;单一实现防两处漂移)----

/**
 * alias 词边界命中:前不得是 [A-Za-z0-9_.-];后不得是标识符延续(单词字符、连字符,
 * 或「.」后跟单词字符——版本号下一段)。「4.8.」这类英文句尾句点不算延续(Anthropic
 * 条目为英文句子,「Claude Opus 4.8. See…」须命中);中文不算边界内字符。
 */
export function aliasIn(alias: string, description: string): boolean {
  const re = new RegExp(`(?<![\\w.-])${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-]|\\.\\w)`)
  return re.test(description)
}

/** slug 路径命中且尾部带边界(「…/glm-4」不认领「…/glm-4-long」「…/glm-4.x」)。 */
export function slugIn(slug: string, docUrl: string): boolean {
  const re = new RegExp(`${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w.-])`)
  return re.test(docUrl)
}

/**
 * 结构化 ID 列表的残余线索(ADR-0051):resolve 不认领且非 `-latest` 引用别名的
 * ID,逐个一条裸键线索(全未认领与部分认领同构——同一模型永不双行)。OpenAI 与
 * 通义共用(单一实现防两处漂移;排除规则演进只改这里)。
 */
export function residualIdClues(
  ids: readonly string[],
  resolveId: (id: string) => string | null,
  base: { occurredOn: string; titleOf: (id: string) => string; sourceUrl: string },
): PendingClue[] {
  const residual = [...new Set(ids.filter((id) => resolveId(id) === null && !isReferenceAlias(id)))]
  return residual.map((id) => ({
    occurredOn: base.occurredOn,
    title: `${id}:${base.titleOf(id)}`,
    sourceUrl: base.sourceUrl,
    modelKey: id,
  }))
}

/** residualIdClues 的排除谓词:`-latest` 引用别名不另算模型(CONTEXT)。 */
export const isReferenceAlias = (id: string): boolean => id.endsWith('-latest')

/** 英文月份名 → 两位数(Anthropic/xAI/OpenAI 三家日期归一共用)。 */
export const MONTHS: Record<string, string> = {
  January: '01', February: '02', March: '03', April: '04', May: '05', June: '06',
  July: '07', August: '08', September: '09', October: '10', November: '11', December: '12',
}
