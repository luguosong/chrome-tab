import { createHash } from 'node:crypto'
import type { Db } from './db'
import { fetchText } from './common'

/**
 * 跨域批量 LLM 译制机制(CONTEXT.md「译文表」;ADR-0029 首建于新闻标题、ADR-0030
 * 复用于趋势描述、ADR-0032 地基归位):候选模型链 + 宁原文勿空;批量编号列表 ≤20 条/请求、
 * 批间串行(free 渠道限流敏感,不并发,changelog 同纪律);漏行/畸行返回 null 由调用方依
 * 自身轮询节奏免费重试。域特化(system prompt、语言判定、译文表归属)在各域模块。
 *
 * 本文件同时是译制机制的**地基**(ADR-0032):网关地址/候选链/响应解析/哈希派生住在这里,
 * changelog/news/trending 三域消费——机制不得反向依赖任何域模块。
 */

// ---- LLM 网关地基(自 changelog.ts 归位,ADR-0032;原文注释随迁)----

/** 译文表主键派生(哈希即身份:原文变即新键,同原文终身复用;三域译文表同款)。 */
export const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')

export const LLM_BASE_URL = 'https://aihubmix.com/v1'

/** 从 OpenAI 兼容响应取 choices[0].message.content;任何畸形形态返回 null(调用方据此降级英文)。 */
export function extractContent(resp: unknown): string | null {
  const choices = (resp as { choices?: unknown } | null)?.choices
  if (!Array.isArray(choices) || choices.length === 0) return null
  const content = (choices[0] as { message?: { content?: unknown } })?.message?.content
  return typeof content === 'string' ? content : null
}

/**
 * 译制模型候选链(2026-08-27):free 优先(coding-glm-5.3-flash-free 打头),free 全不可用落到付费 coding-glm-5.3。
 * 候选失效 = 403/404(模型被禁/不存在)、429/5xx(限流/网关错)、400 no_available_channel(渠道没了)、超时(挂死)或 200 但响应无 content(空补全);其他错误(401 key/网络)换模型无益,直接抛。
 * CHANGELOG_LLM_MODEL 支持逗号分隔列表覆盖;Key 沿用 AIHUBMIX_API_KEY。
 */
const DEFAULT_LLM_MODELS =
  'coding-glm-5.3-flash-free,coding-glm-5.3-free,coding-kimi-k3-free,gemini-3.7-flash-free,gpt-5.5-free,coding-glm-5-free,coding-glm-5.3'

export function modelCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  // 空串/纯分隔符(如 ",")回退默认:compose 引用行对 .env 缺省键注入的是 ''(非
  // undefined;此键现无 compose 透传行、线上走默认链);纯分隔符过滤后为空列表会让
  // 候选链恒空、`throw lastErr` 抛 undefined(code-review 补齐)
  const list = (env.CHANGELOG_LLM_MODEL ?? '').split(',').map((m) => m.trim()).filter(Boolean)
  return list.length ? list : DEFAULT_LLM_MODELS.split(',')
}

/** 网关对该候选「没戏了,换下一个」的判定:模型被禁/不存在(403/404)、限流/网关错(429/5xx,
 *  换候选=换渠道可能绕开)、无渠道(400 no_available_channel)、超时(fetchText 的
 *  AbortSignal.timeout 抛 TimeoutError——挂死的 free 模型换下一个,不再单点拖满上限)。 */
export function isCandidateExhausted(e: unknown): boolean {
  const err = e as { status?: number; body?: string; name?: string }
  return (
    err?.status === 403 ||
    err?.status === 404 ||
    err?.status === 429 ||
    (err?.status ?? 0) >= 500 ||
    err?.name === 'TimeoutError' ||
    /no_available_channel/.test(err?.body ?? '')
  )
}

/**
 * 发请求闸门(free 渠道限额 2026-08-27 告示:5 次/分钟、500 次/天、100 万 Token/天):
 * 进程级单例,连续网关请求至少间隔 env LLM_MIN_REQUEST_INTERVAL_MS(0/空/非数回默认
 * 12_000ms;测试注入小值跳过等待)——住 callModel 原语内部(ADR-0037),任何走原语的
 * 消费者(changelog 单段链 / news / trending 批量链)自动共享同一闸门主动避 429,而非
 * 全靠候选链事后换路(换路只在限额按模型计时有效,按账号计时换路无用)。检查与占位
 * 之间无 await(JS 单线程原子),并发轮询亦正确排队;间隔按「发起时刻」计,请求耗时算
 * 在外,实际速率恒 ≤ 上限。付费兜底同受此闸约束——兜底一天碰不了几次,代价可忽略。
 */
let nextRequestAt = 0
async function gateRequest(): Promise<void> {
  const intervalMs = Number(process.env.LLM_MIN_REQUEST_INTERVAL_MS) || 12_000
  for (;;) {
    const now = Date.now()
    if (now >= nextRequestAt) {
      nextRequestAt = now + intervalMs
      return
    }
    await new Promise((r) => setTimeout(r, nextRequestAt - now))
  }
}

/**
 * 调一个候选模型一次(候选链的内层原语,ADR-0032 起单点):POST /chat/completions →
 * { content, resp }。content = 解析出的译文或 null(200 无 content = 候选失效形态);
 * resp 总是带回,供外层失败日志附响应体切片。fetch 错误上抛(外层 isCandidateExhausted
 * 分类)。**不做日志**——日志格式是各外层的运维 interface,原语返回数据不打印。
 * 发请求前先过闸门(ADR-0037:限流是「调一次模型」的内层时序纪律,进原语由构造保证,
 * 不依赖调用方记得过闸——changelog 单段链此前即绕闸裸奔)。
 */
export async function callModel(
  model: string,
  apiKey: string,
  system: string,
  user: string,
): Promise<{ content: string | null; resp: string }> {
  await gateRequest()
  const resp = await fetchText(`${LLM_BASE_URL}/chat/completions`, 60_000, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  })
  try {
    return { content: extractContent(JSON.parse(resp)), resp }
  } catch {
    return { content: null, resp }
  }
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
 * 候选链逐模型尝试(换路判定 isCandidateExhausted,见本文件地基区);一批全链失效上抛
 * 由 warn 吞掉(条目哈希未写下轮重试),部分成功即接受——漏行条目下轮再来。
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
      let lastErr: unknown
      let fatal = false // key/网络类错(401 等):换模型无益,终止后续批,但已得成果照常返回
      for (const [i, model] of models.entries()) {
        // 逐候选一行结果日志(changelog 同款,2026-08-25 静默事故的血泪:无日志无法区分
        // 限流/内容过滤/模型禁用)
        const log = (outcome: string, extra = '') =>
          console.warn(`[${logTag}] 批 ${start / BATCH_SIZE + 1} 候选 ${i + 1}/${models.length} ${model} ${outcome}${extra}`)
        try {
          const beganAt = Date.now()
          const { content, resp } = await callModel(model, apiKey, systemPrompt, user)
          // 200 但拿不到 content / 解析零配对:视同候选失效换下一个(changelog 同款静默失败形态)
          const parsed = content == null ? [] : parseNumberedTranslations(content, batch.length)
          const paired = parsed.filter((t) => t != null).length
          if (paired === 0) {
            // || 而非 ??:content 为空串时 ''?.slice 产 '' 且 '' ?? _ 不回落,排障切片两头皆丢
            lastErr = new Error(`响应无可配对译文:${content?.slice(0, 200) || resp.slice(0, 200)}`)
            log(`失败(${Date.now() - beganAt}ms),换下一候选`)
            continue
          }
          for (const [j, t] of parsed.entries()) if (t != null) out[start + j] = t
          log(`成功 ${paired}/${batch.length} 条(${Date.now() - beganAt}ms)`)
          break // 本批已有产出即止(漏行下轮重试,不换候选重试——限流友好)
        } catch (e) {
          if (!isCandidateExhausted(e)) {
            // 上抛会把前面批次已付 token 的成果一并丢弃——warn 后终止,带着成果返回
            log(`不可换路错误,终止本批后续: ${e}`)
            lastErr = e
            fatal = true
            break
          }
          lastErr = e
          log(`候选失效,换下一: ${e}`)
        }
      }
      if (fatal) break // 全局性错误(401/断网)对后续批同样成立,不再无谓尝试
      // 本批全链失效不上抛:前面批次成果照常返回入库,本批条目保持 null 下轮重试
      if (!batch.some((_, j) => out[start + j] != null)) {
        console.warn(`[${logTag}] 批 ${start / BATCH_SIZE + 1} 全候选失效:`, lastErr)
      }
    }
    return out
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
