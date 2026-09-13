import { createHash } from 'node:crypto'
import { Annotation, END, START, StateGraph, type BaseCheckpointSaver } from '@langchain/langgraph'
import type {
  AvailabilityMode,
  ModelEvent,
  ModelEventKind,
  ModelKind,
  ModelProviderId,
  ReleaseStage,
} from 'chrome-tab-shared'
import { adjudicateField, type FieldCurrent, type FieldObservation, type SourceRole } from './adjudication'
import type { FieldEvidence } from './evidence'
import { callModel } from './llm'
import { AVAILABILITY, MODEL_KINDS, RELEASE_STAGES, SOURCE_EXCERPT, parseLlmJson, safeHost, validLimits, validPricing } from './modelVerify'
import { isRealIsoDate } from './providers/def'
import type { PendingClue } from './providers/def'

/**
 * 核验图(CONTEXT.md「核验 Agent」「无人值守数据核验」;ADR-0062 决策一,issues/04):
 * LangGraph StateGraph 双段协议——调查节点(受限只读读取器,多步取证)→ 复核节点(零工具,
 * 只看证据与提案)→ 图内最终事务节点(消费票 03 裁决,经注入事务执行器单事务落库)。
 * 本域唯一新测试接缝:工厂全依赖注入产出编译图,单测、回放(票 09)与生产(票 05)走同一
 * `graph.invoke`,断言最终 state 的出口字段与提案结构(只测外部行为,不测图内部节点顺序)。
 *
 * 出口四类:噪音 / 接纳 / 暂缓(证据不足或复核分歧,终态待证据指纹变化重开)/ 系统错误(退避
 * 重试)。精度序 = 误报最不可接受:引用必须在已抓原文中核实(编造引用即丢弃,字段自然暂缓),
 * 新模型插行必须 stage/availability 双双裁决过硬,任一家庭模型不可用或结论分歧即暂缓不降级。
 *
 * 图为无环三节点(条件边只向前进)——「节点数上限」由结构保证,死循环不可能;轮数/读取数/
 * 总时长三预算见 VERIFICATION_BUDGET。线索账本记账、指纹重开语义、cron 重扫在图外(票 05)。
 */

/** 一次核验任务:线索 + 该厂家注册信源白名单(六类注册表由票 06 组装,现为接线方拼 def.urls)。 */
export interface VerificationTask {
  provider: ModelProviderId
  clue: PendingClue
  /** 受限读取器白名单:调查节点只允许读这些 URL(role = 裁决矩阵的权源判定输入)。 */
  sources: ReadonlyArray<{ role: SourceRole; url: string }>
}

/** 该家档案行投影(调查上下文 = 判「新独立型号 vs 既有别名」的底册;commit 节点定位目标)。 */
export interface ArchiveModelRef {
  modelId: number
  officialId: string
  name: string
  stage: string
  matchAliases: readonly string[]
}

/**
 * 调查产出的逐字段提案:值 + 引用。引用三关(任一不过 → observation null,字段将在裁决处
 * 因证据不足暂缓):① sourceUrl 须为本轮成功读取的白名单信源;② excerpt 须在该信源原文中
 * 命中(白空格归一后子串;防编造引用);③ value 形态须过值域硬校验(宁丢勿坏)。
 */
export interface FieldCitation {
  field: string
  value: unknown
  observation: FieldObservation | null
}

/** 调查节点产物:噪音结论,或身份 + 逐字段提案(调查推理不进 state——复核结构性拿不到)。
 *  模型种类字段名 modelKind:让位给判别字段 kind。 */
export type InvestigationResult =
  | { kind: 'noise'; reason: string }
  | { kind: 'proposal'; officialId: string; name: string; modelKind: ModelKind; summary: string | null; matchAliases: string[]; citations: FieldCitation[] }

/** 复核节点产物(零工具单发):整体同意与否 + 复核依据。 */
export interface ReviewResult {
  agree: boolean
  reason: string
}

/** 出口四类(暂缓三因:证据不足 / 复核分歧 / 模型家族不可用——ADR「任一不可用即暂缓」)。 */
export type VerificationExit =
  | { kind: 'noise'; reason: string }
  | { kind: 'accept'; target: 'insert' | 'update'; fields: Array<Omit<FieldLanding, 'evidence'>> }
  | { kind: 'defer'; cause: 'insufficient' | 'disagreement' | 'unavailable'; reason: string }
  | { kind: 'error'; reason: string }

/** 新模型插行(执行器事务内插行;两必备字段 stage/availability 须双双裁决 accept/supersede——无过硬证据即整单暂缓,不猜值)。 */
export interface AcceptInsertRow {
  provider: ModelProviderId
  officialId: string
  name: string
  kind: ModelKind
  stage: ReleaseStage
  availability: AvailabilityMode[]
  summary: string | null
  matchAliases: string[]
  sources: Array<{ title: string; url: string }>
}

/** 单字段裁决落点(票 03 三态):defer 带 reason(暂缓归因);其余带待追加证据行。 */
export interface FieldLanding {
  field: string
  decision: 'accept' | 'supersede' | 'defer'
  evidence?: FieldEvidence
  deferReason?: string
}

/**
 * 接纳落库计划:图内最终事务节点一次交给注入执行器的完整单据。**执行器契约**:单事务落库
 * (证据行 append + 档案插行/事件 + 线索账本终态,幂等可重放 = 状态守卫 + 冲突跳过);
 * insert 路径 evidence.modelId 为占位常量,插行取 id 后重写(证据内容指纹不含 modelId,重写安全)。
 * 生产执行器归接线票(05 影子期 = jsonl 落点,切换后 = SQLite 事务);本模块只产出计划。
 */
export interface AcceptPlan {
  clue: PendingClue
  target: { kind: 'update'; modelId: number } | { kind: 'insert'; row: AcceptInsertRow }
  fields: FieldLanding[]
  events: Array<Omit<ModelEvent, 'id'>>
}

/** insert 路径证据行 modelId 占位:插行前不可知真 id,执行器重写(见 AcceptPlan 契约)。 */
export const PLACEHOLDER_MODEL_ID = 1

/** 图工厂注入面(测试零真网;生产装配在接线票):受限读取底座 + callModel + 只读档案/证据访问 + 事务执行器。 */
export interface VerificationDeps {
  /** 白名单外 URL 到不了这里(节点内拒绝);30s 同旧核验信源抓取口径。 */
  fetchText: (url: string, timeoutMs: number) => Promise<string>
  /** 只读档案:该家全部档案行。 */
  listModels: (provider: ModelProviderId) => Promise<ReadonlyArray<ArchiveModelRef>>
  /** 只读历史证据:该家全部证据行(调查上下文白名单第三件——提案与历史出处的时间轴可见;
   *  图内按 (模型, 字段) 取最新行进 prompt,精确 current 归 fieldCurrent)。 */
  listEvidence: (provider: ModelProviderId) => Promise<ReadonlyArray<FieldEvidence>>
  /** 只读证据:(模型, 字段) 当前值投影(commit 节点 adjudicateField 的 current 输入)。 */
  fieldCurrent: (modelId: number, field: string) => Promise<FieldCurrent | null>
  /** LLM 单次调用(网关闸门在其内部;图传核验口径 120s 超时)。 */
  call: typeof callModel
  /** 图内最终事务执行器:接纳计划单事务落库。 */
  commit: (plan: AcceptPlan) => Promise<void>
  env: NodeJS.ProcessEnv
}

/**
 * 核验预算(用户故事 41:证据不足时不死循环烧钱)。轮数 = 调查段 LLM 调用上限(一轮可请求
 * 多个信源);读取数 = 去重后实际抓取上限;总时长 = 墙钟 deadline(超限即暂缓,证据指纹变化
 * 自动重开)。LLM 超时 120s 仅核验域(ADR-0062 决策一),其余消费者维持 60s(llm.ts 缺省)。
 */
export const VERIFICATION_BUDGET = {
  investigationRounds: 4,
  sourceReads: 8,
  deadlineMs: 10 * 60_000,
  llmTimeoutMs: 120_000,
} as const

/**
 * 双段模型配置(ADR-0062 决策一):调查 = coding-glm-5.3、复核 = gpt-5.5-free(互异家族),
 * 各一单值环境键、**自锁不降级**——不回退候选链,任一不可用即暂缓;缺省 = ADR 钉死的家族。
 */
export function verificationModels(env: NodeJS.ProcessEnv): { investigate: string; review: string } {
  return {
    investigate: env.VERIFY_INVESTIGATE_LLM_MODEL?.trim() || 'coding-glm-5.3',
    review: env.VERIFY_REVIEW_LLM_MODEL?.trim() || 'gpt-5.5-free',
  }
}

/** 「模型家族不可用」判定:网关明确该模型服务不了(被禁/不存在 403/404、限额 429、无渠道)→
 *  暂缓(ADR:任一不可用即暂缓);网关自身故障(5xx)/超时/断网是瞬时系统错误 → error 退避重试。
 *  与 llm.ts isCandidateExhausted 字面共享子集但意图相反(「不可用换不了路」vs「可换路」),
 *  不提取共享谓词——两侧演化方向不同(自锁单值 vs 候选链)。 */
const isModelUnavailable = (e: unknown): boolean => {
  const err = e as { status?: number; body?: string }
  return err?.status === 403 || err?.status === 404 || err?.status === 429 || /no_available_channel/.test(err?.body ?? '')
}

/** 错误转可读串(出口 reason 用;unknown 兜底 String)。 */
const errText = (e: unknown): string => String((e as Error)?.message ?? e)

// ---- 调查节点 ----

const INVESTIGATE_SYSTEM = `你是 AI 模型档案核验的调查员。给你一条来自某厂家官方发布源的「待核验线索」、该厂家既有档案模型清单、可读信源清单。判断该线索是否为该厂家自家新发布的独立模型型号(独立产品差异的变体算独立型号;移动别名、latest 引用、日期快照、平台/SDK 功能条目、第三方托管模型、纯别名/更名、fine-tune 变体、纯价格调整、region 公告都不算),并取证提出逐字段提案。

协议:每轮只输出一个 JSON 对象,无 markdown 围栏,无解释:
索取原文:{"action":"read","urls":["可读清单内的 URL"]}
判噪音:{"action":"final","isNoise":true,"reason":"判定依据一句话"}
提案:{"action":"final","isNoise":false,"officialId":"该家 API 模型 ID(原文口径)","name":"模型名","kind":"text|multimodal_understanding|image_generation|video_generation|audio_speech|embedding|rerank|moderation_classification","summary":"一句话定位(中文,可空)","matchAliases":["认领别名"],"fields":[{"field":"released_at|pricing|limits|training_params|availability|stage|retired_at","value":值,"sourceUrl":"已读信源 URL","excerpt":"原文连续片段"}]}

规则:
- fields 的 field 只能取上述值域。value 形态:released_at/retired_at 为 "YYYY-MM-DD";pricing 为 {"region":"...","effectiveFrom":null,"entries":[{"text":"官方原文","scope":null}]};limits 为 [{"label":"...","text":"官方原文","scope":null}];training_params 为 {"total":"官方原文(如 744B)","active":null};availability 为 ["api"|"first_party_app"|"open_weights"] 数组;stage 为 "experimental|preview|beta|ga|deprecated|retired"。
- sourceUrl 必须来自已读信源;excerpt 必须是该信源原文的连续片段(白空格可不同)——无法在原文中核实的引用会被丢弃,对应字段因证据不足暂缓。
- 宁缺勿编:信源未明确披露的字段不填,不估不编。同一字段可多信源各引一条(目录在场可作 api 的佐证)。`

/** 读取缓存行(节点内闭包持有,不进 state——checkpoint 只记摘要产物)。 */
interface ReadRecord {
  role: SourceRole
  content: string
  observedAt: string
}

const collapseWs = (s: string): string => s.replace(/\s+/g, ' ').trim()

/** 引用核实:excerpt 在已抓原文中命中(白空格归一子串;防编造引用)。 */
const excerptInContent = (content: string, excerpt: string): boolean =>
  collapseWs(content).includes(collapseWs(excerpt))

/** 提案值形态硬校验(值域单源 = modelVerify 旧链尺 + shared 枚举;非矩阵字段放行,交裁决处暂缓)。 */
function validFieldValue(field: string, value: unknown): boolean {
  switch (field) {
    case 'released_at':
    case 'retired_at':
      return typeof value === 'string' && isRealIsoDate(value)
    case 'stage':
      return typeof value === 'string' && RELEASE_STAGES.has(value)
    case 'availability':
      return Array.isArray(value) && value.length > 0 && value.every((a) => typeof a === 'string' && AVAILABILITY.has(a))
    case 'pricing':
      return validPricing(value) !== null
    case 'limits':
      return validLimits(value) !== null
    case 'training_params': {
      const v = value as { total?: unknown; active?: unknown }
      return typeof value === 'object' && value !== null && typeof v.total === 'string' && (v.active === null || typeof v.active === 'string')
    }
    default:
      return true
  }
}

function investigationUser(
  task: VerificationTask,
  archive: ReadonlyArray<ArchiveModelRef>,
  evidence: ReadonlyArray<FieldEvidence>,
  reads: ReadonlyMap<string, ReadRecord>,
  failed: ReadonlySet<string>,
  notice: string,
): string {
  // 历史证据投影:按 (模型, 字段) 取最新行(decidedAt 序——append-only 下裁决时刻近者新)
  const officialOf = new Map(archive.map((m) => [m.modelId, m.officialId]))
  const latest = new Map<string, FieldEvidence>()
  for (const row of evidence) {
    const key = `${row.modelId}|${row.field}`
    const prev = latest.get(key)
    if (prev === undefined || row.decidedAt > prev.decidedAt) latest.set(key, row)
  }
  const lines = [
    `厂家:${task.provider}`,
    `线索:${task.clue.title}`,
    `线索日期:${task.clue.occurredOn}`,
    `线索信源页:${task.clue.sourceUrl}`,
    `线索唯一键:${task.clue.modelKey}`,
    '',
    '既有档案模型(该家已入档;线索若只是其中别名/变体/托管第三方即噪音):',
    archive.length === 0 ? '(无)' : archive.map((m) => `- ${m.officialId}(${m.name},stage=${m.stage},别名:${m.matchAliases.join('/') || '无'})`).join('\n'),
    '',
    '历史证据(各字段最新值出处;与既有出处矛盾时如实引用,冲突由裁决矩阵处理):',
    latest.size === 0
      ? '(无)'
      : [...latest.values()].map((r) => `- ${officialOf.get(r.modelId) ?? r.modelId}.${r.field} ← ${r.sourceUrl}(裁决 ${r.decidedAt.slice(0, 10)}):${r.excerpt.slice(0, 60)}`).join('\n'),
    '',
    '可读信源(只可读这些 URL,其余一律拒绝):',
    task.sources.length === 0 ? '(无)' : task.sources.map((s) => `- [${s.role}] ${s.url}`).join('\n'),
  ]
  if (reads.size > 0) {
    lines.push('', '已读信源原文:')
    for (const [url, r] of reads) lines.push(`--- ${url}(role=${r.role}) ---\n${r.content.slice(0, SOURCE_EXCERPT)}`)
  }
  if (failed.size > 0) lines.push('', `抓取失败(勿引用):${[...failed].join('、')}`)
  if (notice !== '') lines.push('', `(${notice})`)
  return lines.join('\n')
}

/**
 * 证据指纹 = SHA-256(线索三元组 + 各信源页内容;spec 实现决策):成功读取带全文、失败带标记,
 * URL 序排序保证确定性;不含观察时刻——同页重放指纹不变。图外消费(票 05 thread_id 与账本
 * 同指纹守终态/变化重开)。
 */
function computeEvidenceFingerprint(task: VerificationTask, reads: ReadonlyMap<string, ReadRecord>, failed: ReadonlySet<string>): string {
  const parts = [`${task.provider}|${task.clue.modelKey}|${task.clue.sourceUrl}`]
  for (const [url, r] of [...reads.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) parts.push(`${url}\n${r.content}`)
  for (const url of [...failed].sort()) parts.push(`${url}\n(fetch-failed)`)
  return createHash('sha256').update(parts.join('\n\n')).digest('hex')
}

/** LLM final 输出 → 身份(硬校验:officialId/name 非空、kind 在值域;不过 → null = 证据不足暂缓)。 */
function validateIdentity(raw: Record<string, unknown>): { officialId: string; name: string; modelKind: ModelKind; summary: string | null; matchAliases: string[] } | null {
  const officialId = typeof raw.officialId === 'string' ? raw.officialId.trim() : ''
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  const kind = typeof raw.kind === 'string' ? raw.kind : ''
  if (officialId === '' || name === '' || !MODEL_KINDS.has(kind)) return null
  const aliases = Array.isArray(raw.matchAliases)
    ? raw.matchAliases.filter((a): a is string => typeof a === 'string' && a.trim() !== '')
    : []
  return {
    officialId,
    name,
    modelKind: kind as ModelKind,
    summary: typeof raw.summary === 'string' && raw.summary.trim() !== '' ? raw.summary : null,
    matchAliases: aliases.length > 0 ? aliases : [officialId],
  }
}

function investigateNode(deps: VerificationDeps) {
  return async (state: VerificationStateType): Promise<Partial<VerificationUpdateType>> => {
    const { task } = state
    const fingerprintOf = (reads: ReadonlyMap<string, ReadRecord>, failed: ReadonlySet<string>) =>
      computeEvidenceFingerprint(task, reads, failed)
    const apiKey = deps.env.AIHUBMIX_API_KEY ?? ''
    if (apiKey === '') return { investigation: null, fingerprint: null, exit: { kind: 'error', reason: '未配置 AIHUBMIX_API_KEY(核验不可用)' } }
    const models = verificationModels(deps.env)
    const whitelist = new Map(task.sources.map((s) => [s.url, s]))
    const deadline = Date.now() + VERIFICATION_BUDGET.deadlineMs
    const reads = new Map<string, ReadRecord>()
    const failed = new Set<string>()
    let notice = ''
    try {
      const archive = await deps.listModels(task.provider)
      const evidence = await deps.listEvidence(task.provider)
      for (let round = 1; round <= VERIFICATION_BUDGET.investigationRounds; round++) {
        if (Date.now() > deadline) {
          return { investigation: null, fingerprint: fingerprintOf(reads, failed), exit: { kind: 'defer', cause: 'insufficient', reason: `核验总时长超限(${VERIFICATION_BUDGET.deadlineMs / 60_000}min),等证据指纹变化重开` } }
        }
        const user = investigationUser(task, archive, evidence, reads, failed, notice)
        const { content } = await deps.call(models.investigate, apiKey, INVESTIGATE_SYSTEM, user, VERIFICATION_BUDGET.llmTimeoutMs)
        const parsed = content === null ? null : parseLlmJson(content)
        if (parsed === null || typeof parsed.action !== 'string') {
          notice = '上一轮输出无法解析,请只输出一个 JSON 对象(协议见系统提示)'
          continue
        }
        if (parsed.action === 'read') {
          const wanted = [...new Set((Array.isArray(parsed.urls) ? parsed.urls : []).filter((u): u is string => typeof u === 'string'))]
          const offList = wanted.filter((u) => !whitelist.has(u))
          const fetchable = wanted.filter((u) => whitelist.has(u) && !reads.has(u) && !failed.has(u))
          const allowed = fetchable.slice(0, VERIFICATION_BUDGET.sourceReads - reads.size - failed.size)
          const newlyFailed: string[] = []
          for (const url of allowed) {
            if (Date.now() > deadline) break
            try {
              reads.set(url, { role: whitelist.get(url)!.role, content: await deps.fetchText(url, 30_000), observedAt: new Date().toISOString() })
            } catch {
              failed.add(url)
              newlyFailed.push(url)
            }
          }
          // 信源全败短路(ADR:不再以占位串进 prompt):白名单内已全部尝试且零成功 → 系统错误,不进下一轮
          const attemptedInWhitelist = reads.size + [...failed].filter((u) => whitelist.has(u)).length
          if (reads.size === 0 && whitelist.size > 0 && attemptedInWhitelist >= whitelist.size) {
            return { investigation: null, fingerprint: fingerprintOf(reads, failed), exit: { kind: 'error', reason: `信源全败:白名单 ${whitelist.size} 个信源全部抓取失败` } }
          }
          const parts: string[] = []
          if (offList.length > 0) parts.push(`以下 URL 不在可读清单,已拒绝:${offList.join('、')}`)
          if (newlyFailed.length > 0) parts.push(`本轮抓取失败:${newlyFailed.join('、')}(勿引用)`)
          if (allowed.length < fetchable.length) parts.push('读取次数已达上限,未读请求被拒绝')
          notice = parts.join(';')
          continue
        }
        if (parsed.action === 'final') {
          const fingerprint = fingerprintOf(reads, failed)
          if (parsed.isNoise === true) {
            const reason = typeof parsed.reason === 'string' && parsed.reason.trim() !== '' ? parsed.reason : '调查判定非自家新独立型号'
            return { investigation: { kind: 'noise', reason }, fingerprint, exit: null }
          }
          // 身份硬校验不过 = 判自家但证据不足(旧链 insufficient 语义):整单暂缓,复核无从复核
          const identity = validateIdentity(parsed)
          if (identity === null) {
            return { investigation: null, fingerprint, exit: { kind: 'defer', cause: 'insufficient', reason: typeof parsed.reason === 'string' && parsed.reason !== '' ? parsed.reason : '提案身份校验未过(缺 officialId/name 或 kind 越值域),信源依据不足' } }
          }
          const rawFields = Array.isArray(parsed.fields) ? parsed.fields : []
          const citations: FieldCitation[] = rawFields.map((f) => {
            const f2 = f as { field?: unknown; value?: unknown; sourceUrl?: unknown; excerpt?: unknown }
            const field = typeof f2.field === 'string' ? f2.field : ''
            const sourceUrl = typeof f2.sourceUrl === 'string' ? f2.sourceUrl : ''
            const excerpt = typeof f2.excerpt === 'string' ? f2.excerpt : ''
            const read = reads.get(sourceUrl)
            if (field === '' || read === undefined || !excerptInContent(read.content, excerpt) || !validFieldValue(field, f2.value)) {
              return { field, value: f2.value, observation: null }
            }
            return {
              field,
              value: f2.value,
              observation: { role: read.role, sourceUrl, observedAt: read.observedAt, excerpt, value: f2.value },
            }
          })
          return { investigation: { kind: 'proposal', ...identity, citations }, fingerprint, exit: null }
        }
        notice = 'action 须为 read 或 final'
      }
      return { investigation: null, fingerprint: fingerprintOf(reads, failed), exit: { kind: 'defer', cause: 'insufficient', reason: `调查轮数达上限(${VERIFICATION_BUDGET.investigationRounds})未出最终结论,等证据指纹变化重开` } }
    } catch (e) {
      if (isModelUnavailable(e)) {
        return { investigation: null, fingerprint: fingerprintOf(reads, failed), exit: { kind: 'defer', cause: 'unavailable', reason: `调查模型(${models.investigate})不可用,自锁不降级即暂缓:${errText(e)}` } }
      }
      return { investigation: null, fingerprint: fingerprintOf(reads, failed), exit: { kind: 'error', reason: `调查失败:${errText(e)}` } }
    }
  }
}

// ---- 复核节点(零工具,只看证据与提案)----

const REVIEW_SYSTEM = `你是 AI 模型档案核验的独立复核员。你只看证据与提案(没有调查过程),独立判断:噪音判定是否与证据一致;字段提案是否被引用证据真实支撑(引用片段确实支撑该值、值形态合法)。有实质疑点即不同意——复核从严,误接纳(假模型/错值入档)最不可接受。

只输出一个 JSON 对象,无围栏无解释:{"agree": true, "reason": "复核依据一句话"} 或 {"agree": false, "reason": "疑点一句话"}`

function reviewUser(task: VerificationTask, inv: NonNullable<InvestigationResult>): string {
  const head = `厂家:${task.provider}\n线索:${task.clue.title}(${task.clue.occurredOn})\n`
  if (inv.kind === 'noise') {
    return `${head}\n调查结论:噪音(非自家新独立型号)——${inv.reason}\n\n请独立复核该判定。`
  }
  const proposal = { officialId: inv.officialId, name: inv.name, kind: inv.modelKind, summary: inv.summary, matchAliases: inv.matchAliases, fields: inv.citations.map((c) => ({ field: c.field, value: c.value })) }
  const evidence = inv.citations.filter((c) => c.observation !== null).map((c) => ({ field: c.field, ...c.observation }))
  return `${head}\n调查提案:\n${JSON.stringify(proposal)}\n\n引用证据(逐字段):\n${JSON.stringify(evidence)}\n\n请独立复核提案是否被证据支撑。`
}

function reviewNode(deps: VerificationDeps) {
  return async (state: VerificationStateType): Promise<Partial<VerificationUpdateType>> => {
    const inv = state.investigation
    if (inv === null || state.fingerprint === null) {
      return { review: null, exit: { kind: 'error', reason: '复核前置缺失(不可达路由)' } }
    }
    const apiKey = deps.env.AIHUBMIX_API_KEY ?? ''
    if (apiKey === '') return { review: null, exit: { kind: 'error', reason: '未配置 AIHUBMIX_API_KEY(核验不可用)' } }
    const models = verificationModels(deps.env)
    try {
      const { content } = await deps.call(models.review, apiKey, REVIEW_SYSTEM, reviewUser(state.task, inv), VERIFICATION_BUDGET.llmTimeoutMs)
      const parsed = content === null ? null : parseLlmJson(content)
      if (parsed === null || typeof parsed.agree !== 'boolean') throw new Error(`复核输出非约定 JSON:${(content ?? '').slice(0, 200)}`)
      const reason = typeof parsed.reason === 'string' ? parsed.reason : ''
      if (parsed.agree) {
        // 噪音结论复核同意 → 出口即噪音;提案同意 → exit 留空,路由进最终事务节点
        return inv.kind === 'noise'
          ? { review: { agree: true, reason }, exit: { kind: 'noise', reason: inv.reason } }
          : { review: { agree: true, reason }, exit: null }
      }
      return { review: { agree: false, reason }, exit: { kind: 'defer', cause: 'disagreement', reason: reason === '' ? '复核不同意调查结论' : `复核分歧:${reason}` } }
    } catch (e) {
      if (isModelUnavailable(e)) {
        return { review: null, exit: { kind: 'defer', cause: 'unavailable', reason: `复核模型(${models.review})不可用,自锁不降级即暂缓:${errText(e)}` } }
      }
      return { review: null, exit: { kind: 'error', reason: `复核失败:${errText(e)}` } }
    }
  }
}

// ---- 图内最终事务节点(消费票 03 裁决)----

const hostOf = (url: string): string => safeHost(url) ?? url

/** 接纳的语义化事件(用户故事 7/8:出自厂家明确文字 = 已裁决过硬的证据):线索公告 updated +
 *  released_at→released、retired_at→retired、stage 弃/退、availability 新增(比对当前值)、
 *  价格取代→updated(故事 7「价格变动自动生成模型动态」;事件类型值域无价格专用 kind)。 */
function deriveEvents(
  clue: PendingClue,
  name: string,
  accepted: ReadonlyMap<string, unknown>,
  superseded: ReadonlySet<string>,
  primarySource: ReadonlyMap<string, string>,
  currentAvailability: readonly AvailabilityMode[],
): Array<Omit<ModelEvent, 'id'>> {
  const events: Array<Omit<ModelEvent, 'id'>> = [
    { kind: 'updated', occurredOn: clue.occurredOn, title: clue.title, sourceUrl: clue.sourceUrl },
  ]
  const src = (f: string) => primarySource.get(f) ?? clue.sourceUrl
  if (superseded.has('pricing')) events.push({ kind: 'updated', occurredOn: clue.occurredOn, title: `${name} 价格更新`, sourceUrl: src('pricing') })
  const released = accepted.get('released_at')
  if (typeof released === 'string') events.push({ kind: 'released', occurredOn: released, title: `${name} 正式发布`, sourceUrl: src('released_at') })
  const retired = accepted.get('retired_at')
  if (typeof retired === 'string') events.push({ kind: 'retired', occurredOn: retired, title: `${name} 退役`, sourceUrl: src('retired_at') })
  const stage = accepted.get('stage')
  if (stage === 'deprecated' || stage === 'retired') {
    events.push({ kind: stage, occurredOn: clue.occurredOn, title: `${name} ${stage === 'deprecated' ? '弃用' : '退役'}`, sourceUrl: src('stage') })
  }
  const availability = accepted.get('availability')
  if (Array.isArray(availability)) {
    const titles: Record<AvailabilityMode, string> = { api: 'API 可用', first_party_app: '应用内可用', open_weights: '权重开放' }
    const kinds: Record<AvailabilityMode, ModelEventKind> = { api: 'api_available', first_party_app: 'first_party_available', open_weights: 'weights_available' }
    for (const raw of availability) {
      const m = raw as AvailabilityMode
      if ((m === 'api' || m === 'first_party_app' || m === 'open_weights') && !currentAvailability.includes(m)) {
        events.push({ kind: kinds[m], occurredOn: clue.occurredOn, title: `${name} ${titles[m]}`, sourceUrl: src('availability') })
      }
    }
  }
  return events
}

function commitNode(deps: VerificationDeps) {
  return async (state: VerificationStateType): Promise<Partial<VerificationUpdateType>> => {
    const inv = state.investigation
    if (inv === null || inv.kind !== 'proposal') {
      return { exit: { kind: 'error', reason: '落库前置缺失(不可达路由)' } }
    }
    const { task } = state
    const models = verificationModels(deps.env)
    const decidedModel = `${models.investigate}+${models.review}`
    const decidedAt = new Date().toISOString()
    try {
      const archive = await deps.listModels(task.provider)
      const existing = archive.find((m) => m.officialId === inv.officialId)
      const modelId = existing?.modelId ?? PLACEHOLDER_MODEL_ID
      // 同字段多条提案:末条为提案值,前条退为观察(值不一致时裁决矩阵判跨信源冲突 → 暂缓)
      const lastPerField = new Map<string, FieldCitation>()
      for (const c of inv.citations) lastPerField.set(c.field, c)
      const landings: FieldLanding[] = []
      const accepted = new Map<string, unknown>()
      const primarySource = new Map<string, string>()
      for (const [field, c] of lastPerField) {
        const observations = inv.citations.filter((x) => x.field === field && x.observation !== null).map((x) => x.observation!)
        const current = existing === undefined ? null : await deps.fieldCurrent(existing.modelId, field)
        const verdict = adjudicateField({ modelId, field, proposedValue: c.value, observations, current, decidedModel, decidedAt })
        if (verdict.decision === 'defer') {
          landings.push({ field, decision: 'defer', deferReason: verdict.reason })
        } else {
          landings.push({ field, decision: verdict.decision, evidence: verdict.evidence })
          accepted.set(field, c.value)
          primarySource.set(field, verdict.evidence.sourceUrl)
        }
      }
      const superseded = new Set(landings.filter((l) => l.decision === 'supersede').map((l) => l.field))
      let plan: AcceptPlan
      if (existing !== undefined) {
        // 既有模型:逐字段裁决;全部暂缓 = 本单无可落 → 证据不足整单暂缓
        if (accepted.size === 0) {
          return { exit: { kind: 'defer', cause: 'insufficient', reason: `提案 ${landings.map((l) => `${l.field}(${l.deferReason})`).join(';')}` } }
        }
        const currentAvailability = accepted.has('availability')
          ? ((await deps.fieldCurrent(existing.modelId, 'availability'))?.value as AvailabilityMode[] | undefined) ?? []
          : []
        plan = {
          clue: task.clue,
          target: { kind: 'update', modelId: existing.modelId },
          fields: landings,
          events: deriveEvents(task.clue, inv.name, accepted, superseded, primarySource, currentAvailability),
        }
      } else {
        // 新模型:插行必备 stage + availability 双双过硬,缺一整单暂缓(不猜值)
        const stage = accepted.get('stage')
        const availability = accepted.get('availability')
        const required: string[] = []
        if (typeof stage !== 'string') required.push(`stage:${landings.find((l) => l.field === 'stage')?.deferReason ?? '未提案'}`)
        if (!Array.isArray(availability) || availability.length === 0) required.push(`availability:${landings.find((l) => l.field === 'availability')?.deferReason ?? '未提案'}`)
        if (required.length > 0) {
          return { exit: { kind: 'defer', cause: 'insufficient', reason: `新模型插行缺过硬 stage/availability——${required.join(';')}` } }
        }
        const citedSources = [...new Set(inv.citations.filter((c) => c.observation !== null).map((c) => c.observation!.sourceUrl))]
          .map((url) => ({ title: hostOf(url), url }))
        plan = {
          clue: task.clue,
          target: {
            kind: 'insert',
            row: {
              provider: task.provider,
              officialId: inv.officialId,
              name: inv.name,
              kind: inv.modelKind,
              stage: stage as ReleaseStage,
              availability: availability as AvailabilityMode[],
              summary: inv.summary,
              matchAliases: inv.matchAliases,
              sources: citedSources,
            },
          },
          fields: landings,
          events: deriveEvents(task.clue, inv.name, accepted, superseded, primarySource, []),
        }
      }
      await deps.commit(plan)
      return {
        exit: {
          kind: 'accept',
          target: plan.target.kind,
          fields: landings.map((l) => ({ field: l.field, decision: l.decision, ...(l.deferReason === undefined ? {} : { deferReason: l.deferReason }) })),
        },
      }
    } catch (e) {
      return { exit: { kind: 'error', reason: `落库事务失败(退避重试,重放由执行器幂等守卫):${errText(e)}` } }
    }
  }
}

// ---- 图工厂 ----

const VerificationStateAnnotation = Annotation.Root({
  task: Annotation<VerificationTask>,
  investigation: Annotation<InvestigationResult | null>,
  /** 证据指纹(SHA-256;票 05 消费:thread_id 与账本同指纹守终态/变化重开)。 */
  fingerprint: Annotation<string | null>,
  review: Annotation<ReviewResult | null>,
  exit: Annotation<VerificationExit | null>,
})

type VerificationStateType = typeof VerificationStateAnnotation.State
type VerificationUpdateType = typeof VerificationStateAnnotation.Update

/**
 * 核验图工厂:依赖全注入产出编译图——单测、回放(票 09)与生产(票 05)以同一
 * `graph.invoke({ task }, config?)` 消费。checkpointer(SqliteSaver,票 05 接线)注入即
 * 支持相同 thread_id 断点续跑;本图消费侧无需传(checkpointer 缺省 = 不持久化)。
 */
export function makeVerificationGraph(deps: VerificationDeps, checkpointer?: BaseCheckpointSaver) {
  return new StateGraph(VerificationStateAnnotation)
    // 节点名不可与 state 通道同名(LangGraph 约束):复核节点名 recheck,产物通道名 review
    .addNode('investigate', investigateNode(deps))
    .addNode('recheck', reviewNode(deps))
    .addNode('commit', commitNode(deps))
    .addEdge(START, 'investigate')
    // 条件边只向前进(无环):exit 已定 → 终;噪音/提案都进复核(结论分歧即暂缓,复核从严)
    .addConditionalEdges('investigate', (s) => (s.exit !== null ? END : 'recheck'))
    .addConditionalEdges('recheck', (s) => (s.exit !== null ? END : 'commit'))
    .addEdge('commit', END)
    .compile({ checkpointer })
}

export type VerificationGraph = ReturnType<typeof makeVerificationGraph>
