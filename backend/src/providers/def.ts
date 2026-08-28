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
 * are live」可多条);未命中 → 待核验线索(null = 不落线索,如月暗文章流、无
 * `Model:` 字段的平台条目)。
 */
export interface MatchEntryResult {
  hits: MatchedHit[]
  clue: PendingClue | null
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
  /** 信源原文 → 条目数组;零条目由 runPoll 统一判「上游改版」。 */
  parse: (md: string) => E[]
  /** 单条目分派(见 MatchEntryResult)。 */
  matchEntry(e: E): MatchEntryResult
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

/** 英文月份名 → 两位数(Anthropic/xAI/OpenAI 三家日期归一共用)。 */
export const MONTHS: Record<string, string> = {
  January: '01', February: '02', March: '03', April: '04', May: '05', June: '06',
  July: '07', August: '08', September: '09', October: '10', November: '11', December: '12',
}
