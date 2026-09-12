import { createHash } from 'node:crypto'
import type { Db } from './db'
import {
  callModel,
  CandidateExhausted,
  isCandidateExhausted,
  modelCandidates,
  runCandidateChain,
} from './llm'

/**
 * 跨域批量 LLM 译制机制(CONTEXT.md「译文表」;ADR-0029 首建于新闻标题、ADR-0030
 * 复用于趋势描述、ADR-0061 网关边界):候选模型链 + 宁原文勿空;批量编号列表 ≤20 条/请求、
 * 批间串行(free 渠道限流敏感,不并发,changelog 同纪律);漏行/畸行返回 null 由调用方依
 * 自身轮询节奏免费重试。域特化(system prompt、语言判定、译文表归属)在各域模块。
 *
 * 网关地址/候选链/响应解析由 LLM Gateway(ADR-0061)统一持有；本文件保留译制域的
 * 分段、编号协议、提示词、译文表和输出校验。
 */

/** 译文表主键派生(哈希即身份:原文变即新键,同原文终身复用;三域译文表同款)。 */
export const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')

/** 版本块再切段(2026-08-26;ADR-0053 自 changelog.ts 归位——分段是「怎么送 LLM」的译制
 *  机制,补全 ADR-0032 地基清单):段 = 连续整行(行是原子,不撕开),总长 ≤ maxChars;
 *  单行自身超限独占一段。动机:非流式译制耗时 ∝ 输出长度,2.1.246 块 9.2k 字符单请求
 *  生成 >60s,7 候选全超时;切段后单请求输出 ~1/N(~700 字符),稳离 60s 上限,
 *  段失败换候选只重试该段。段边界在行尾,译文段拼回即整块译文。 */
export function splitSegments(block: string, maxChars = 2000): string[] {
  if (block.length <= maxChars) return [block]
  const segments: string[] = []
  let cur = ''
  for (const line of block.split(/(?<=\n)/)) {
    if (cur && cur.length + line.length > maxChars) {
      segments.push(cur)
      cur = ''
    }
    cur += line
  }
  if (cur) segments.push(cur)
  return segments
}

// ---- 批量编号协议 ----

/** 批量上限(ADR-0029:逐条请求对 free 渠道限流不友好,存量补译首轮百余条慢一个数量级)。 */
const BATCH_SIZE = 20

/** 批量译制器:与输入对齐返回译文(null = 该条本轮未译成,调用方保持原文)。 */
export type BatchTranslator = (texts: string[]) => Promise<(string | null)[]>

/** 构造批输入的编号列表(批内 1..N)。与 parseNumberedTranslations 对偶:模型忠实
 * 回显序号时,任何一批都须全额配对——全局连续编号会让第 2 批起恒解析为空(已复现)。 */
export const buildNumberedList = (texts: string[]) => texts.map((t, i) => `${i + 1}. ${t}`).join('\n')

/**
 * 解析 LLM 编号列表输出 → 按序号(1 基)配对的译文数组。漏行/畸行/超范围序号 → 该条
 * null(调用方下轮重试);宽容剥 ``` 围栏与空行。返回长度恒等于 count。
 */
export function parseNumberedTranslations(output: string, count: number): (string | null)[] {
  const out: (string | null)[] = Array.from({ length: count }, () => null)
  for (const raw of output.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const bare = line.replace(/^```[a-z]*$/i, '').trim() // 围栏行剥壳(裸 ``` 或 ```text)
    if (!bare) continue
    const m = bare.match(/^(\d+)[.、:：]\s*(.+)$/)
    if (!m) continue
    const text = m[2].trim()
    if (!text) continue // 纯空白译文不入槽:空串会以哈希主键终身缓存,feed 渲染成空白行
    const idx = Number(m[1]) - 1
    if (idx < 0 || idx >= count) continue
    // ponytail: 先来优先 + 任意「数字.」行即配对——多行译文内嵌编号子列表时可抢占槽位,
    // 错误片段终身缓存;短文本 + prompt 单行约束下罕见,悬停原文可核,复现再收紧协议
    if (out[idx] == null) out[idx] = text
  }
  return out
}

/**
 * 生产译制器:无 Key 恒返全 null(Service 据此保持原文,同 changelog「Key 缺失拒绝」)。
 * 候选链经 runCandidateChain(ADR-0060:软失效哨兵 ∪ isCandidateExhausted 两源换路);
 * 一批全链失效由 warn 吞掉(条目哈希未写下轮重试),部分成功即接受——漏行条目下轮再来。
 */
export function makeBatchTranslator(
  systemPrompt: string,
  logTag: string,
  env: NodeJS.ProcessEnv = process.env,
): BatchTranslator {
  const apiKey = env.AIHUBMIX_API_KEY ?? ''
  const models = modelCandidates(env)
  return async (texts) => {
    const out: (string | null)[] = texts.map(() => null)
    // 有声拒绝(对齐 changelog「译制被拒绝(Key 缺失?)」范式):静默 return 会与其他
    // 「零译制日志」形态混作一团,排障只能猜(2026-08-26 事故探针成本)
    if (!apiKey) {
      console.warn(`[${logTag}] 未配置 AIHUBMIX_API_KEY,本轮跳过译制,保持原文`)
      return out
    }
    for (let start = 0; start < texts.length; start += BATCH_SIZE) {
      const batch = texts.slice(start, start + BATCH_SIZE)
      // 批内重新编号 1..N(非全局连续):解析器按批内序号配对,全局编号会让第 2 批起
      // 恒解析为空(code-review 复现确认)
      const user = buildNumberedList(batch)
      const verdict = await runCandidateChain(models, async (model, i, total) => {
        // 逐候选一行结果日志(changelog 同款,2026-08-25 静默事故的血泪:无日志无法区分
        // 限流/内容过滤/模型禁用);成败日志住 attempt——runner 零日志(ADR-0032 纪律)
        const log = (outcome: string, extra = '') =>
          console.warn(`[${logTag}] 批 ${start / BATCH_SIZE + 1} 候选 ${i}/${total} ${model} ${outcome}${extra}`)
        const beganAt = Date.now()
        try {
          const { content, resp } = await callModel(model, apiKey, systemPrompt, user)
          // 200 但拿不到 content / 解析零配对:视同候选失效换下一个(changelog 同款静默失败形态)
          const parsed = content == null ? [] : parseNumberedTranslations(content, batch.length)
          const paired = parsed.filter((t) => t != null).length
          if (paired === 0) {
            // || 而非 ??:content 为空串时 ''?.slice 产 '' 且 '' ?? _ 不回落,排障切片两头皆丢
            const err = new CandidateExhausted(`响应无可配对译文:${content?.slice(0, 200) || resp.slice(0, 200)}`)
            log(`失败(${Date.now() - beganAt}ms),换下一候选`)
            throw err
          }
          log(`成功 ${paired}/${batch.length} 条(${Date.now() - beganAt}ms)`)
          return parsed // 本批已有产出即止(runner answer 即停,不换候选重试——限流友好)
        } catch (e) {
          if (e instanceof CandidateExhausted) throw e // 软失效日志已记,不双写
          // 上抛会把前面批次已付 token 的成果一并丢弃——warn 后由映射终止,带着成果返回
          if (isCandidateExhausted(e)) log(`候选失效,换下一: ${e}`)
          else log(`不可换路错误,终止本批后续: ${e}`)
          throw e
        }
      })
      if (verdict.status === 'answer') {
        // 部分配对即收:漏行条目保持 null,调用方下轮免费重试
        for (const [j, t] of verdict.value.entries()) if (t != null) out[start + j] = t
      } else if (verdict.status === 'fatal') {
        break // 全局性错误(401/断网)对后续批同样成立,不再无谓尝试
      } else if (!batch.some((_, j) => out[start + j] != null)) {
        // 本批全链失效不上抛:前面批次成果照常返回入库,本批条目保持 null 下轮重试
        console.warn(`[${logTag}] 批 ${start / BATCH_SIZE + 1} 全候选失效:`, verdict.lastErr)
      }
    }
    return out
  }
}

// ---- 单块分段译制(「更新日志」版本块)----

/** 单块分段译制器(ADR-0053 自 changelog.ts prodChangelogDeps 归位):
 *  null = 拒绝(未配 Key,调用方保持原文);抛错 = 整块失败(调用方 warn 降级)。
 *  onPhase:每次尝试一个候选模型前上报 (model, 候选序 1 基, 链长),调用方据此暴露译制阶段。 */
export type BlockTranslator = (
  block: string,
  onPhase?: (model: string, attempt: number, total: number) => void,
) => Promise<string | null>

/**
 * 单块分段译制 maker:块切段(splitSegments)→ 串行逐段过候选链(runCandidateChain,
 * ADR-0060)→ 段序拼接。Key 缺失恒返 null。
 * 串行逐段(free 渠道限流敏感,不并发);非末段译文补尾换行——LLM 偶尔丢,缺了会与
 * 下段粘行(末段不补:单段块行为不变,块级兜底在调用方 assemble)。
 */
export function makeBlockTranslator(
  systemPrompt: string,
  logTag: string,
  env: NodeJS.ProcessEnv = process.env,
): BlockTranslator {
  const apiKey = env.AIHUBMIX_API_KEY ?? ''
  const models = modelCandidates(env)
  return async (block, onPhase) => {
    if (!apiKey) return null
    const segments = splitSegments(block)
    /** 单段走候选链:候选失效换下一个,全链失效上抛(整块失败,调用方 warn 降级)。 */
    const translateSegment = async (seg: string, si: number): Promise<string> => {
      const verdict = await runCandidateChain(
        models,
        async (model, i, total) => {
          const startedAt = Date.now()
          // 每次尝试一行结果日志(线上排障:段/模型/序号/耗时/status+body/走向,全部收容器 stdout)
          const log = (outcome: string, extra = '') =>
            console.warn(
              `[${logTag}] 段${si + 1}/${segments.length} 候选 ${i}/${total} ${model} ${outcome}(${Date.now() - startedAt}ms)${extra}`,
            )
          try {
            const { content, resp } = await callModel(model, apiKey, systemPrompt, seg)
            // 200 但拿不到译文(空补全/内容过滤/非 JSON 响应体)也按候选失效换下一个——
            // 2026-08-25 线上即此形态静默失败:后台有 200 调用记录、无后续候选、译文缺位。
            // 空串同判:空译文会以哈希主键终身缓存,该版本永久渲染成空行(批量路径
            // parseNumberedTranslations 的 !text 守卫同款)
            if (content == null || !content.trim()) throw new CandidateExhausted(`HTTP 200 但响应无 content:${resp.slice(0, 200)}`)
            log(`成功: ${content.length} 字符`)
            return content
          } catch (e) {
            if (e instanceof CandidateExhausted) log(`失败: ${e}`, ',换下一候选') // 软失效日志在此,不双写
            else if (isCandidateExhausted(e)) log(`失败: ${e} ${(e as { body?: string }).body ?? ''}`, ',换下一候选')
            else log(`失败: ${e}`, ',换模型无益,放弃本次译制')
            throw e
          }
        },
        onPhase,
      )
      if (verdict.status === 'answer') return verdict.value
      if (verdict.status === 'fatal') throw verdict.err
      throw verdict.lastErr
    }
    const out: string[] = []
    for (const [si, seg] of segments.entries()) out.push(await translateSegment(seg, si))
    return out
      .map((t, i) => (i < out.length - 1 && !t.endsWith('\n') ? `${t}\n` : t))
      .join('')
  }
}

// ---- 哈希译文仓(ADR-0034:三张「译文表」存储机制单点)----

/** 三张「译文表」表名(三表同形,仅主键列名异,见 schema.ts)。 */
export type TranslationTable = 'changelog_translations' | 'news_translations' | 'trending_translations'

/** in 查询分批上限:三域三答案的统一收编(news 500/批先例;361/25 量级单批不变,
 *  行为中性)。SQLite 单语句参数上限 32766,500 保守低于它。 */
const LOAD_CHUNK = 500

/** 统一行形状(分派支内以字面量列名换取 Kysely 全类型,零 cast)。 */
type HashRow = { hash: string; translated: string }

/**
 * 哈希译文仓(ADR-0034):「译文表」的 load/save/ensure 单点。键 = **原文**——
 * 哈希派生是 implementation,调用方不再知道(三域 join 从 `zh.get(sha256(x))`
 * 变 `zh.get(x)`)。空/空白译文不入库(空哈希行会终身缓存成空白,2026-08-25 事故
 * 形态)。失败上抛:带域上下文(源 id/块标题)的降级 catch 留在各域——同 ADR-0032
 * 「日志格式是各外层的运维 interface」的裁定。
 *
 * 表名↔主键列名配对不走动态列名(Kysely 0.29 的 dynamic.ref 无 .as,联合 builder
 * 的 select/where 签名互斥)——判别分派各写字面量列名,配对由结构保证,编译器背书。
 */
export function makeTranslationStore(db: Db, table: TranslationTable) {
  const nowIso = () => new Date().toISOString()

  async function loadRows(hashes: string[]): Promise<HashRow[]> {
    if (table === 'changelog_translations') {
      const rows = await db
        .selectFrom('changelog_translations')
        .select(['block_hash', 'translated'])
        .where('block_hash', 'in', hashes)
        .execute()
      return rows.map((r) => ({ hash: r.block_hash, translated: r.translated }))
    }
    if (table === 'news_translations') {
      const rows = await db
        .selectFrom('news_translations')
        .select(['title_hash', 'translated'])
        .where('title_hash', 'in', hashes)
        .execute()
      return rows.map((r) => ({ hash: r.title_hash, translated: r.translated }))
    }
    const rows = await db
      .selectFrom('trending_translations')
      .select(['desc_hash', 'translated'])
      .where('desc_hash', 'in', hashes)
      .execute()
    return rows.map((r) => ({ hash: r.desc_hash, translated: r.translated }))
  }

  async function insertRows(rows: Array<{ hash: string; translated: string; created_at: string }>): Promise<void> {
    if (table === 'changelog_translations') {
      await db
        .insertInto('changelog_translations')
        .values(rows.map((r) => ({ block_hash: r.hash, translated: r.translated, created_at: r.created_at })))
        .onConflict((oc) => oc.column('block_hash').doNothing())
        .execute()
      return
    }
    if (table === 'news_translations') {
      await db
        .insertInto('news_translations')
        .values(rows.map((r) => ({ title_hash: r.hash, translated: r.translated, created_at: r.created_at })))
        .onConflict((oc) => oc.column('title_hash').doNothing())
        .execute()
      return
    }
    await db
      .insertInto('trending_translations')
      .values(rows.map((r) => ({ desc_hash: r.hash, translated: r.translated, created_at: r.created_at })))
      .onConflict((oc) => oc.column('desc_hash').doNothing())
      .execute()
  }

  /** 原文集合 → 已有译文(原文键);入参去重,分批 LOAD_CHUNK/查询。 */
  async function load(texts: readonly string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>()
    // 哈希→原文的反查表:行返回哈希,interface 说话用原文
    const byHash = new Map([...new Set(texts)].map((t) => [sha256(t), t]))
    for (let i = 0; i < byHash.size; i += LOAD_CHUNK) {
      const rows = await loadRows([...byHash.keys()].slice(i, i + LOAD_CHUNK))
      for (const r of rows) map.set(byHash.get(r.hash)!, r.translated)
    }
    return map
  }

  /** 译文对入库(哈希即身份):onConflict doNothing 幂等,先入为主终身不覆盖;
   *  空/纯空白译文丢弃(终身缓存防线)。 */
  async function save(pairs: ReadonlyArray<{ text: string; translated: string }>): Promise<void> {
    const rows = pairs
      .filter((p) => p.translated.trim() !== '')
      .map((p) => ({ hash: sha256(p.text), translated: p.translated, created_at: nowIso() }))
    if (rows.length === 0) return
    await insertRows(rows)
  }

  /**
   * 批量补译编排(原 news/trending translateMissing 骨架归一):域过滤 → 去重 →
   * load → 滤缺 → 批译 → null 丢弃入库。null 译文不写,由调用方轮询节奏免费重试。
   * 失败上抛——带域上下文(源 id/块标题)的降级 catch 留在域,同本文件头注裁定。
   * filter 必传:调用方总有一个「哪些原文不值得送译」的域口径(news 剔换行标题、
   * trending 汉字启发式),没有就显式传 () => true。
   */
  async function ensure(
    texts: readonly string[],
    translate: BatchTranslator,
    filter: (t: string) => boolean,
  ): Promise<void> {
    const candidates = [...new Set(texts.filter(filter))]
    if (candidates.length === 0) return
    const known = await load(candidates)
    const missing = candidates.filter((t) => !known.has(t))
    if (missing.length === 0) return
    const translated = await translate(missing)
    await save(missing.map((t, i) => ({ text: t, translated: translated[i] ?? null })).filter(
      (p): p is { text: string; translated: string } => p.translated != null,
    ))
  }

  return { load, save, ensure }
}

export type TranslationStore = ReturnType<typeof makeTranslationStore>
