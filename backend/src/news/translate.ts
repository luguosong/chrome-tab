import { fetchText } from '../common'
import { extractContent, isCandidateExhausted, LLM_BASE_URL, modelCandidates, sha256 } from '../changelog'

/**
 * 新闻英文源标题译制(ADR-0029,CONTEXT.md「新闻」译制语汇):照搬「更新日志」译制范式
 * ——候选模型链 + 宁英勿空。译文按标题 SHA-256 持久化(news_translations),同标题
 * 跨条目跨源终身只译一次;批量编号列表 ≤20 条/请求、批间串行(free 渠道限流敏感,
 * 不并发,changelog 同纪律);漏行/畸行返回 null 由调用方下轮重试(30min 免费回路)。
 * 译制只认源清单(TRANSLATED_SOURCES),否决逐条语言检测(ADR-0029)。
 */

/** 标题哈希(译文表主键;与 changelog_translations.block_hash 同派生,复用同实现防分叉)。 */
export { sha256 as titleHash }

/** 需要译制的英文源(按源硬编码,新英文源加一行)。 */
export const TRANSLATED_SOURCES: ReadonlySet<string> = new Set(['hackernews', 'producthunt'])

/** 批量上限(ADR-0029:逐条请求对 free 渠道限流不友好,存量补译首轮百余条慢一个数量级)。 */
const BATCH_SIZE = 20

/** 译制系统提示(ADR-0029 第 7 条口径:前缀/标注原样,专名/emoji/定价词原样,不扩写)。 */
const NEWS_SYSTEM_PROMPT = `你是专业技术新闻编辑。把用户给出的编号英文标题列表逐条译成简体中文,输出同样编号的中文标题列表。
严格约束：
1. 输出与输入逐条对应：每行「序号. 译文」,不添加任何解释、前后缀,也不要代码围栏。
2. Show HN:、Ask HN:、Tell HN: 等开头前缀与 [video]、[pdf] 等方括号标注保留英文原样,只译正文。
3. 专有名词、产品名、公司名、代码标识符、API 名保留英文原样。
4. emoji、数字、定价词（$5、free 等）原样保留。
5. 译文简洁贴近原题长度,不扩写不解释。`

/** 构造批输入的编号列表(批内 1..N)。与 parseNumberedTranslations 对偶:模型忠实
 * 回显序号时,任何一批都须全额配对——全局连续编号会让第 2 批起恒解析为空(已复现)。 */
export const buildNumberedList = (titles: string[]) => titles.map((t, i) => `${i + 1}. ${t}`).join('\n')

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
    // 错误片段终身缓存;短标题 + prompt 单行约束下罕见,悬停英文原文可核,复现再收紧协议
    if (out[idx] == null) out[idx] = text
  }
  return out
}

/** 批量标题译制器:与输入对齐返回译文(null = 该条本轮未译成,调用方保持英文)。 */
export type TitleTranslator = (titles: string[]) => Promise<(string | null)[]>

/**
 * 生产译制器:无 Key 恒返全 null(Service 据此保持英文,同 changelog「Key 缺失拒绝」)。
 * 候选链逐模型尝试(换路判定复用 changelog isCandidateExhausted);一批全链失效上抛
 * (整轮译制失败 warn,条目哈希未写下轮重试),部分成功即接受——漏行条目下轮再来。
 */
export function prodTitleTranslator(env: NodeJS.ProcessEnv = process.env): TitleTranslator {
  const apiKey = env.AIHUBMIX_API_KEY ?? ''
  const models = modelCandidates(env)
  return async (titles) => {
    const out: (string | null)[] = titles.map(() => null)
    if (!apiKey) return out
    for (let start = 0; start < titles.length; start += BATCH_SIZE) {
      const batch = titles.slice(start, start + BATCH_SIZE)
      // 批内重新编号 1..N(非全局连续):解析器按批内序号配对,全局编号会让第 2 批起
      // 恒解析为空(code-review 复现确认)
      const user = buildNumberedList(batch)
      let lastErr: unknown
      let fatal = false // key/网络类错(401 等):换模型无益,终止后续批,但已得成果照常返回
      for (const [i, model] of models.entries()) {
        // 逐候选一行结果日志(changelog 同款,2026-08-25 静默事故的血泪:无日志无法区分
        // 限流/内容过滤/模型禁用)
        const log = (outcome: string, extra = '') =>
          console.warn(`[news-translate] 批 ${start / BATCH_SIZE + 1} 候选 ${i + 1}/${models.length} ${model} ${outcome}${extra}`)
        try {
          const beganAt = Date.now()
          const resp = await fetchText(`${LLM_BASE_URL}/chat/completions`, 60_000, {
            method: 'POST',
            headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
            body: JSON.stringify({
              model,
              messages: [
                { role: 'system', content: NEWS_SYSTEM_PROMPT },
                { role: 'user', content: user },
              ],
            }),
          })
          let content: string | null = null
          try {
            content = extractContent(JSON.parse(resp))
          } catch {
            content = null
          }
          // 200 但拿不到 content / 解析零配对:视同候选失效换下一个(changelog 同款静默失败形态)
          const parsed = content == null ? [] : parseNumberedTranslations(content, batch.length)
          const paired = parsed.filter((t) => t != null).length
          if (paired === 0) {
            lastErr = new Error(`响应无可配对译文:${content?.slice(0, 200) ?? resp.slice(0, 200)}`)
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
        console.warn(`[news-translate] 批 ${start / BATCH_SIZE + 1} 全候选失效:`, lastErr)
      }
    }
    return out
  }
}
