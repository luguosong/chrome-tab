import { fetchText } from './common'

/**
 * LLM Gateway:简单补全机制单点(ADR-0061,自 translate.ts 网关地基深化而出):
 * 网关地址、模型候选、候选链循环、进程级请求闸门与 OpenAI 兼容响应解析住在这里;
 * prompt、输出校验、持久化与日志留各调用方。消费者:批量/分段译制(translate.ts)
 * 与模型核验(modelVerify.ts);ai/agent.ts 仅引网关地址——tool-call 多步循环与
 * 300s 超时语义不属简单补全链,保留在 agent。机制不反向依赖任何域模块。
 */

export const LLM_BASE_URL = 'https://aihubmix.com/v1'

/**
 * 译制模型候选链(2026-08-27):free 优先(coding-glm-5.3-flash-free 打头),free 全不可用落到付费 coding-glm-5.3-flash。
 * CHANGELOG_LLM_MODEL 支持逗号分隔列表覆盖;Key 沿用 AIHUBMIX_API_KEY。
 */
const DEFAULT_LLM_MODELS =
  'coding-glm-5.3-flash-free,coding-glm-5.3-free,coding-kimi-k3-free,gemini-3.7-flash-free,gpt-5.5-free,coding-glm-5-free,coding-glm-5.3-flash'

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

/** 软失效哨兵:200 但产物不可用(批量的「配对数 0」、块的「空 content」、核验的「非
 *  JSON」)。什么算不可用是调用方域知识,住各 attempt 内以 throw 表达;runner 将本哨兵
 *  与 isCandidateExhausted 两源合一判「此候选没戏,换下一个」。 */
export class CandidateExhausted extends Error {}

/** 候选链一次运行的终局三态:answer = 某候选给出确定答案(含核验 reject/insufficient
 *  这类「确定否定」);exhausted = 全链疲竭,带 lastErr(空链时为 null,对齐核验
 *  「全候选失效:null」现状);fatal = 不可换路错误停链,带候选上下文(调用方致命
 *  日志行含「候选 i/N model」前缀,不携带则零 diff 验收破功)。index 为 1 基序数,
 *  对齐日志/onAttempt 口径。 */
export type ChainVerdict<T> =
  | { status: 'answer'; value: T }
  | { status: 'exhausted'; lastErr: unknown }
  | { status: 'fatal'; err: unknown; model: string; index: number }

/** 两源换路判定的合一式(哨兵软失效 ∪ 网关硬错误):runner 的分类核心,调用方各
 *  attempt 的逐候选「换下一」日志同用一式——分类单点,永不双写。 */
function isChainExhausted(e: unknown): boolean {
  return e instanceof CandidateExhausted || isCandidateExhausted(e)
}

/**
 * 候选链 runner(ADR-0060,修订 ADR-0032 决策二的保留范围:循环骨架与换路分类收编,
 * 出口映射仍留调用方):候选迭代 + 两源分类 + lastErr 记账 + 链尽聚合。attempt 是
 * 调用方域闭包(callModel + 软失效判定 + 自产成败日志);onAttempt 每候选尝试前上报
 * (块译制进度上报专用,其余调用方不传)。runner 自身零日志(ADR-0032「原语不打印
 * 日志」纪律);链构造(含核验 VERIFY_LLM_MODEL 单值)在调用方,runner 只迭代传入
 * 数组,永不自行补链。
 */
export async function runCandidateChain<T>(
  models: string[],
  attempt: (model: string, index: number, total: number) => Promise<T>,
  onAttempt?: (model: string, index: number, total: number) => void,
): Promise<ChainVerdict<T>> {
  let lastErr: unknown = null // null 非 undefined:空链时核验侧拼「全候选失效:null」,对齐改线前现状
  for (const [i, model] of models.entries()) {
    onAttempt?.(model, i + 1, models.length)
    try {
      return { status: 'answer', value: await attempt(model, i + 1, models.length) }
    } catch (e) {
      if (!isChainExhausted(e)) return { status: 'fatal', err: e, model, index: i + 1 }
      lastErr = e
    }
  }
  return { status: 'exhausted', lastErr }
}

/**
 * 发请求闸门(free 渠道限额 2026-08-27 告示:5 次/分钟、500 次/天、100 万 Token/天):
 * 进程级单例,连续网关请求至少间隔 env LLM_MIN_REQUEST_INTERVAL_MS(0/空/非数回默认
 * 12_000ms;测试注入小值跳过等待)——住 callModel 原语内部(ADR-0037),任何走原语的
 * 消费者(译制 changelog 单段链 / news / trending 批量链,与模型核验)自动共享同一闸门
 * 主动避 429,而非全靠候选链事后换路(换路只在限额按模型计时有效,按账号计时换路
 * 无用)。检查与占位之间无 await(JS 单线程原子),并发轮询亦正确排队;间隔按「发起
 * 时刻」计,请求耗时算在外,实际速率恒 ≤ 上限。付费兜底同受此闸约束——兜底一天碰
 * 不了几次,代价可忽略。
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

/** 从 OpenAI 兼容响应取 choices[0].message.content;任何畸形形态返回 null(调用方据此降级)。 */
function extractContent(resp: unknown): string | null {
  const choices = (resp as { choices?: unknown } | null)?.choices
  if (!Array.isArray(choices) || choices.length === 0) return null
  const content = (choices[0] as { message?: { content?: unknown } })?.message?.content
  return typeof content === 'string' ? content : null
}

/**
 * 调一个候选模型一次(候选链的内层原语,ADR-0032 起单点):POST /chat/completions →
 * { content, resp }。content = 解析出的产物或 null(200 无 content = 候选失效形态);
 * resp 总是带回,供外层失败日志附响应体切片。fetch 错误上抛(外层 isCandidateExhausted
 * 分类)。**不做日志**——日志格式是各外层的运维 interface,原语返回数据不打印。
 * 发请求前先过闸门(ADR-0037:限流是「调一次模型」的内层时序纪律,进原语由构造保证,
 * 不依赖调用方记得过闸)。
 */
export async function callModel(
  model: string,
  apiKey: string,
  system: string,
  user: string,
  /** 请求超时 ms(缺省 60s = 其余消费者现状;核验图传 120s,ADR-0062 决策一「核验调用超时放宽至 120s,其余消费者维持 60s」)。 */
  timeoutMs = 60_000,
): Promise<{ content: string | null; resp: string }> {
  await gateRequest()
  const resp = await fetchText(`${LLM_BASE_URL}/chat/completions`, timeoutMs, {
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
