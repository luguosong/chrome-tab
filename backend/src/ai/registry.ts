import { z, type ZodType } from 'zod'

/**
 * tool 注册表(ai-platform.md §2):集中单文件注册(tools/index.ts 逐条 import),
 * agent loop 的 dispatch 与 MCP 适配记录同查这一张表,不感知 tool 来源。
 */

/** handler 执行上下文。骨架阶段仅 userId 一个字段;宁多一个参数,不改签名。 */
export interface ToolCtx {
  userId: number
}

export interface Tool<I = any, O = any> {
  name: string
  description: string
  /** zod 4 schema:入参即文档,经 z.toJSONSchema 序列化给网关 */
  schema: ZodType<I>
  handler: (input: I, ctx: ToolCtx) => Promise<O>
}

export interface GatewayTool {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

const tools = new Map<string, Tool>()

export function register<I, O>(tool: Tool<I, O>): void {
  if (tools.has(tool.name)) throw new Error(`tool 重名注册:${tool.name}`)
  tools.set(tool.name, tool as Tool)
}

export function lookup(name: string): Tool | undefined {
  return tools.get(name)
}

/** 序列化成 OpenAI chat 的 tools 参数;names 缺省 = 全表。未注册名 = 调用方 bug,当场抛。 */
export function toGatewayTools(names?: string[]): GatewayTool[] {
  const picked: Tool[] = []
  for (const n of names ?? [...tools.keys()]) {
    const t = lookup(n)
    if (!t) throw new Error(`未注册 tool:${n}`)
    picked.push(t)
  }
  return picked.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      // $schema 键对网关多余,剥掉;strict 模式的全字段 required 不追求(骨架非目标)
      parameters: stripSchemaKey(z.toJSONSchema(t.schema)),
    },
  }))
}

function stripSchemaKey(jsonSchema: unknown): Record<string, unknown> {
  const { $schema: _drop, ...rest } = jsonSchema as Record<string, unknown>
  return rest
}

/** 测试隔离用:清空注册表(生产路径不调用)。 */
export function clearTools(): void {
  tools.clear()
}
