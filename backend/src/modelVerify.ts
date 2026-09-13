import type { PendingClue, ProviderDef } from './providers/def'
import { callModel, CandidateExhausted, modelCandidates, runCandidateChain } from './llm'

/**
 * LLM 自动核验(ADR-0058,2026-09-05「当天时效」grill 定案):待核验线索 → 抓厂家
 * 一手信源原文 → LLM 判定并抽取档案草稿 → 代码硬校验 → accept 入档(verified='auto')。
 * 推翻 ADR-0025「档案行只来自人工核验基线」——误报防线从「人工门槛」单层换为三层:
 * ①确定性噪音规则(def.noiseClue,在 service 挂接处先拦,不进本模块);
 * ②回链护栏:草稿 sources 必须有 URL 与核验信源同 host,LLM 编造的链接进不来;
 * ③auto 行前端带标记可发现、每日 VACUUM 备份可回滚(人工修订 = 会话直改表)。
 * 事件语义保守:入档产 kind 'updated'(标题带原文),api_available 等语义事件仅
 * 人工修订可标——延续 ADR-0025「自动不猜语义」。
 */

/** LLM 核验产出的档案草稿(入 model_archive 的字段形态;枚举合法性由 validateDraft 把关)。 */
export interface VerifiedDraft {
  officialId: string
  name: string
  kind: string
  stage: string
  availability: string[]
  summary: string | null
  sources: Array<{ title: string; url: string }>
  /** ModelPricing 形态(原样透传入库,JSON 序列化;null = 信源未给价)。 */
  pricing: { region?: string; effectiveFrom?: string | null; entries: Array<{ text: string; scope: string | null }> } | null
  /** ModelLimit[] 形态;null = 未披露。 */
  limits: Array<{ label: string; text: string; scope: string | null }> | null
  matchAliases: string[]
}

/**
 * 一次核验的四态:accept(入档)/ reject(噪音或低置信,留线索触人)/ error(调用失败,
 * 下轮重试)/ insufficient(判自家新模型但草稿校验不过——判别与抽取解耦,spec 1.5 裁决 7:
 * 活动窗内触人供人工判断,不重试;信源 7 天窗内更新概率低,重试 = 每轮烧强模型看同一页)。
 */
export type VerifyOutcome =
  | { outcome: 'accept'; draft: VerifiedDraft }
  | { outcome: 'reject'; reason: string }
  | { outcome: 'error'; reason: string }
  | { outcome: 'insufficient'; reason: string }

// 值域 Set 导出(无人值守核验图 issues/04 复用):旧链退役(issues/11)时值域的家随核验域迁移
const MODEL_KINDS = new Set(['text', 'multimodal_understanding', 'image_generation', 'video_generation', 'audio_speech', 'embedding', 'rerank', 'moderation_classification'])
const RELEASE_STAGES = new Set(['experimental', 'preview', 'beta', 'ga', 'deprecated', 'retired'])
const AVAILABILITY = new Set(['api', 'first_party_app', 'open_weights'])
export { MODEL_KINDS, RELEASE_STAGES, AVAILABILITY, SOURCE_EXCERPT }

/** 单信源原文进 prompt 的截断上限(两源合计 ~24k 字符;模型文档页头部即规格区)。
 *  导出供核验图(issues/04)复用:同值同义不另立。 */
const SOURCE_EXCERPT = 12_000

const SYSTEM_PROMPT = `你是 AI 模型档案核验员。给你一条来自某厂家官方发布源的「待核验线索」和该厂家的官方一手信源原文。判断该线索指向的是否为**该厂家自家新发布的独立模型型号**(独立产品差异的变体算独立型号;移动别名、latest 引用、日期快照、平台/SDK 功能条目、第三方托管模型都不算),是则从原文抽取结构化档案草稿。

判据正反例:
- 算独立型号:新模型家族的新成员(如 glm-5.3 之于 glm-5 家族)、新一代版本发布(如 claude-fable-5-1)。
- 不算(判噪音):托管第三方模型(别家模型上架自家平台,如 kimi-k3 上百炼)、纯别名/更名、fine-tune 变体、纯价格调整、region 可用性公告。

只输出一个 JSON 对象,不要 markdown 代码围栏,不要解释:
{"isNoise": false, "reason": "判定依据一句话", "draft": {"officialId": "该家 API 模型 ID(原文口径)", "name": "模型名", "kind": "text|multimodal_understanding|image_generation|video_generation|audio_speech|embedding|rerank|moderation_classification", "stage": "experimental|preview|beta|ga", "availability": ["api","first_party_app","open_weights"], "summary": "一句话定位(中文)", "sources": [{"title": "信源名", "url": "原文中该信息的 URL"}], "pricing": null, "limits": null, "matchAliases": ["认领别名,通常含 officialId"]}}

规则:
- pricing:原文有明确官方价格才填 {"region": "...", "entries": [{"text": "输入 $x/百万 tokens", "scope": null}]},否则 null,不估不编。
- limits:原文明确披露才填 [{"label": "上下文窗口", "text": "原文数值", "scope": null}],否则 null。
- sources 的 url 必须来自所给原文中实际出现的 URL,禁止编造。
- 证据不足:判为自家新模型但原文缺 API ID/定价时,如实报告已知信息(officialId 填原文最接近的标识、pricing 照实 null),不要因信息不全伪装成噪音——isNoise 只反映「是否自家新独立型号」这一判定本身。
- 判定为噪音(非自家新模型)时:{"isNoise": true, "reason": "...", "draft": null}。`

/**
 * 核验一条线索。fetchText/llm 环境经参数注入(测试零真网);LLM 走 callModel 网关
 * (ADR-0037 限流闸自动生效),候选链经 runCandidateChain(ADR-0060:软失效哨兵 ∪
 * isCandidateExhausted 两源换路;不可换路(401/断网)直接 error)。
 */
export async function verifyClue(
  def: ProviderDef<unknown>,
  clue: PendingClue,
  fetchText: (url: string, timeoutMs: number) => Promise<string>,
  env: NodeJS.ProcessEnv,
  /** LLM 单次调用注入(测试零真网);缺省真 callModel(ADR-0037 闸门在其内部)。 */
  call: typeof callModel = callModel,
): Promise<VerifyOutcome> {
  const apiKey = env.AIHUBMIX_API_KEY ?? ''
  if (apiKey === '') return { outcome: 'error', reason: '未配置 AIHUBMIX_API_KEY(auto 核验不可用,人工核验照旧)' }
  const urls = def.verifyUrls?.(clue) ?? [clue.sourceUrl]
  // 信源逐个抓取,单源失败容错为空(如模型文档页 404,changelog 页仍在);全空才 error
  const sources: string[] = []
  for (const url of urls) {
    try {
      const text = await fetchText(url, 30_000)
      sources.push(`--- 信源 ${url} ---\n${text.slice(0, SOURCE_EXCERPT)}`)
    } catch {
      sources.push(`--- 信源 ${url} ---(抓取失败)`)
    }
  }
  const user = `厂家:${def.label}\n线索:${clue.title}\n线索信源页:${clue.sourceUrl}\n线索唯一键:${clue.modelKey}\n\n${sources.join('\n\n')}`
  // 核验固定强模型(票 07,裁决 11):VERIFY_LLM_MODEL 单值即链长 1,语义自锁「不降级」
  // ——判定质量不被译制链 free 弱模型拖累;缺省/空串(compose 缺键注入 '')回退译制候选链
  const fixedModel = env.VERIFY_LLM_MODEL?.trim()
  const models = fixedModel ? [fixedModel] : modelCandidates(env)
  // 软失效(200 无 content / 非 JSON)抛哨兵换下一候选,与硬错误两源合一(ADR-0060);
  // reject/insufficient 是确定答案(answer 停链),不换候选
  const verdict = await runCandidateChain<Exclude<VerifyOutcome, { outcome: 'error' }>>(models, async (model) => {
    const { content } = await call(model, apiKey, SYSTEM_PROMPT, user)
    if (content === null) throw new CandidateExhausted('LLM 响应无 content')
    const parsed = parseLlmJson(content)
    if (parsed === null) throw new CandidateExhausted(`LLM 输出非 JSON:${content.slice(0, 200)}`)
    if (parsed.isNoise === true) return { outcome: 'reject', reason: typeof parsed.reason === 'string' ? parsed.reason : 'LLM 判定非自家新模型' }
    const draft = validateDraft(parsed.draft, urls)
    if (draft !== null) return { outcome: 'accept', draft }
    // isNoise !== true 但草稿校验不过:判别(自家新模型)与抽取(规格证据)解耦,
    // 不伪装 reject(spec 1.5)——留 insufficient 在活动窗内触人,不重试
    return { outcome: 'insufficient', reason: typeof parsed.reason === 'string' ? parsed.reason : '草稿字段校验未过(信源依据不足)' }
  })
  if (verdict.status === 'answer') return verdict.value
  if (verdict.status === 'fatal') return { outcome: 'error', reason: String(verdict.err) }
  return { outcome: 'error', reason: `全候选失效:${verdict.lastErr}` }
}

/** LLM 输出 → JSON 对象;剥 markdown 围栏与前后杂文(取首个 { 到末个 })。 */
export function parseLlmJson(content: string): Record<string, unknown> | null {
  const start = content.indexOf('{')
  const end = content.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    const v = JSON.parse(content.slice(start, end + 1))
    return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** 草稿硬校验(护栏②回链 + 枚举合法):必填齐、枚举在值域、sources 至少一条与核验信源同 host。 */
export function validateDraft(raw: unknown, sourceUrls: readonly string[]): VerifiedDraft | null {
  if (typeof raw !== 'object' || raw === null) return null
  const d = raw as Record<string, unknown>
  const officialId = typeof d.officialId === 'string' ? d.officialId.trim() : ''
  const name = typeof d.name === 'string' ? d.name.trim() : ''
  if (officialId === '' || name === '') return null
  if (!MODEL_KINDS.has(String(d.kind))) return null
  if (!RELEASE_STAGES.has(String(d.stage))) return null
  const availability = Array.isArray(d.availability) ? d.availability.filter((a): a is string => typeof a === 'string' && AVAILABILITY.has(a)) : []
  if (availability.length === 0) return null
  const sources = Array.isArray(d.sources)
    ? d.sources.filter((s): s is { title: string; url: string } =>
        typeof s === 'object' && s !== null && typeof (s as { url?: unknown }).url === 'string' && typeof (s as { title?: unknown }).title === 'string')
    : []
  if (sources.length === 0) return null
  // 回链护栏:至少一条 source URL 与核验信源同 host(防编造链接)
  const sourceHosts = new Set(sourceUrls.map((u) => safeHost(u)).filter((h): h is string => h !== null))
  if (!sources.some((s) => {
    const h = safeHost(s.url)
    return h !== null && sourceHosts.has(h)
  })) return null
  const aliases = Array.isArray(d.matchAliases) ? d.matchAliases.filter((a): a is string => typeof a === 'string' && a.trim() !== '') : []
  return {
    officialId,
    name,
    kind: String(d.kind),
    stage: String(d.stage),
    availability,
    summary: typeof d.summary === 'string' && d.summary.trim() !== '' ? d.summary : null,
    sources,
    // 形状不合法 → null(宁缺勿坏:前端 formatModelPricing 裸读 entries,畸形草稿会白屏)
    pricing: validPricing(d.pricing),
    limits: validLimits(d.limits),
    matchAliases: aliases.length > 0 ? aliases : [officialId],
  }
}

/** pricing 形状:{entries: [{text}...]}(scope 可选);非对象/缺数组/空文本项 → null。
 *  导出供核验图(issues/04)复用:提案值形态硬校验同一把尺。 */
export function validPricing(raw: unknown): VerifiedDraft['pricing'] {
  if (raw === null || raw === undefined || typeof raw !== 'object') return null
  const entries = (raw as { entries?: unknown }).entries
  if (!Array.isArray(entries) || entries.length === 0) return null
  const ok = entries.every(
    (e) => typeof e === 'object' && e !== null && typeof (e as { text?: unknown }).text === 'string' && (e as { text: string }).text !== '',
  )
  if (!ok) return null
  return raw as VerifiedDraft['pricing']
}

/** limits 形状:[{label, text}...];非数组/缺项 → null。导出同 validPricing(核验图复用)。 */
export function validLimits(raw: unknown): VerifiedDraft['limits'] {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const ok = raw.every(
    (e) => typeof e === 'object' && e !== null && typeof (e as { label?: unknown }).label === 'string' && typeof (e as { text?: unknown }).text === 'string',
  )
  return ok ? (raw as VerifiedDraft['limits']) : null
}

/** URL host;非法 URL → null。导出供核验图(issues/04)回链/信源标题复用。 */
export function safeHost(url: string): string | null {
  try {
    return new URL(url).host
  } catch {
    return null
  }
}
