import { lookup, toGatewayTools, type ToolCtx } from './registry'
import { LLM_BASE_URL } from '../translate'

/**
 * agent loop(ai-platform.md §3):普通 async 函数,非流式,骨架阶段无 HTTP 端点。
 * 循环:发 messages+tools → 响应带 tool_calls 则逐个 dispatch 回注册表、结果以 role:"tool"
 * 追加 → 否则返回最终 assistant 消息。步数打满报错上抛,不返回半成品。
 */

// ---- 防失控常量(ai-platform.md §3,写死;收紧须过评审)----
/** 步数上限:8 步 LLM 调用,防无限循环烧钱 */
const MAX_STEPS = 8
/** 同一 tool 连续失败 2 次即中止上抛:错误回喂自纠只给一轮,回喂循环 = 变相烧钱 */
const TOOL_FAIL_LIMIT = 2
// ponytail: connect 10s 需 undici Agent dispatcher(Node 原生 fetch 不分层超时)才能单独生效,
// 骨架零消费者不为此装包;现阶段由 READ_TIMEOUT 上界兜底(请求最多挂 5min,不会永久挂死)。
// 首个真实 MCP server / 慢网消费者上线时装 undici 并接线此处。
export const CONNECT_TIMEOUT_MS = 10_000
/** read 上界 5min(ADR-0017 防挂起):LLM 带工具的多步任务可达分钟级 */
export const READ_TIMEOUT_MS = 300_000

export const DEFAULT_MODEL = 'gpt-5-nano'
// LLM_BASE_URL 见文件头 import:网关地址与译制机制同源(translate.ts,ADR-0032 单点),Key 同用 AIHUBMIX_API_KEY

// ---- 消息模型(OpenAI chat 形状)----

export interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export type Msg =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }

// ---- IO 协作器(ChangelogDeps 同款 seam:测试注入假响应,生产 prodAgentDeps)----

export interface AgentDeps {
  /** 发一次 chat/completions,body 为完整请求体,返回原始 JSON。 */
  complete: (body: unknown) => Promise<unknown>
}

export interface RunAgentOpts {
  /** ctx 从第一天就带 userId:未来 AI 图标的 tool 多半要按用户读写数据 */
  userId: number
  /** tool 名列表;缺省/空 = 请求不带 tools 参数(纯对话) */
  tools?: string[]
  model?: string
  deps?: AgentDeps
}

/** 跑一轮 agent。最终 assistant 消息返回;步数打满或 tool 连续失败即抛错上抛。 */
export async function runAgent(messages: Msg[], opts: RunAgentOpts): Promise<Msg> {
  const deps = opts.deps ?? prodAgentDeps()
  const ctx: ToolCtx = { userId: opts.userId }
  const convo: Msg[] = [...messages]
  const gatewayTools = opts.tools?.length ? toGatewayTools(opts.tools) : undefined
  const fails = new Map<string, number>() // tool 名 → 连续失败次数(成功清零)

  for (let step = 0; step < MAX_STEPS; step++) {
    const assistant = extractAssistantMessage(
      await deps.complete({
        model: opts.model ?? DEFAULT_MODEL,
        messages: [...convo], // 快照:不向 deps 泄漏循环中继续 push 的活数组
        ...(gatewayTools ? { tools: gatewayTools } : {}),
      }),
    )
    // spec 原文判 finish_reason==="tool_calls";此处判 tool_calls 存在——
    // 兼容网关对 finish_reason 实现参差,存在性判据语义等价且更稳健(length 截断的
    // 不完整 arguments 会经 dispatch 的 parse 失败路径回喂自纠,不丢信息)
    if (!assistant.tool_calls?.length) return assistant
    convo.push(assistant)
    for (const call of assistant.tool_calls) convo.push(await dispatch(call, ctx, fails))
  }
  throw new Error(`agent 步数打满 ${MAX_STEPS} 上抛(不返回半成品,调用方无从判断完整性)`)
}

/** 分派单个 tool_calls:未注册/入参不合 schema/执行抛错都走失败路径;成功清零计数。 */
async function dispatch(call: ToolCall, ctx: ToolCtx, fails: Map<string, number>): Promise<Msg> {
  const tool = lookup(call.function.name)
  if (!tool) return failTool(call, fails, `未注册 tool:${call.function.name}`)
  try {
    const input = tool.schema.parse(JSON.parse(call.function.arguments))
    const out = await tool.handler(input, ctx)
    fails.delete(call.function.name)
    return { role: 'tool', tool_call_id: call.id, content: JSON.stringify(out ?? null) }
  } catch (e) {
    return failTool(call, fails, e instanceof Error ? e.message : String(e))
  }
}

/** 单次失败:错误文本以 role:"tool" 回喂模型自纠一轮;连续第 TOOL_FAIL_LIMIT 次即中止上抛。 */
function failTool(call: ToolCall, fails: Map<string, number>, reason: string): Msg {
  const n = (fails.get(call.function.name) ?? 0) + 1
  if (n >= TOOL_FAIL_LIMIT) throw new Error(`tool ${call.function.name} 连续失败 ${n} 次中止:${reason}`)
  fails.set(call.function.name, n)
  console.warn(`tool ${call.function.name} 失败(第 ${n} 次),错误回喂模型自纠:${reason}`)
  return { role: 'tool', tool_call_id: call.id, content: `错误:${reason}` }
}

/** 从 OpenAI 兼容响应取 choices[0].message;畸形形态当场抛(调用方上浮决定降级)。 */
export function extractAssistantMessage(resp: unknown): Msg & { role: 'assistant' } {
  const choices = (resp as { choices?: unknown } | null)?.choices
  const message = Array.isArray(choices) ? (choices[0] as { message?: unknown })?.message : undefined
  const { role, content, tool_calls } = (message ?? {}) as {
    role?: unknown
    content?: unknown
    tool_calls?: unknown
  }
  if (role !== 'assistant' || (content !== null && typeof content !== 'string')) {
    throw new Error('LLM 响应缺 assistant message')
  }
  if (tool_calls === undefined) return { role: 'assistant', content }
  if (!Array.isArray(tool_calls)) throw new Error('LLM 响应 tool_calls 非数组')
  return { role: 'assistant', content, tool_calls: tool_calls as ToolCall[] }
}

// ---- 生产协作器 ----

export function prodAgentDeps(): AgentDeps {
  const apiKey = process.env.AIHUBMIX_API_KEY ?? ''
  return {
    complete: async (body) => {
      if (!apiKey) throw new Error('AIHUBMIX_API_KEY 未配置')
      const res = await fetch(`${LLM_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(READ_TIMEOUT_MS), // read 上界;connect 10s 见常量注释
      })
      if (!res.ok) throw new Error(`chat/completions → HTTP ${res.status}`)
      return res.json()
    },
  }
}
