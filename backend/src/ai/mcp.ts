import type { Tool } from './registry'

/**
 * MCP client 预留(ai-platform.md §4):仅 interface,零依赖,不装 @modelcontextprotocol/client。
 * 首个真实 MCP server 进来时再装包并按此签名写适配函数:listTools 结果转 Tool 记录
 * (name 加 `mcp:<server>:` 前缀防撞名,callTool 包成 handler),register 进同一张注册表
 * ——agent loop 的 dispatch 只查一张表,完全不感知 tool 来源,业务代码零改动。
 * 硬约束:stdio 子进程 transport 默认禁用(每常驻 30~80 MiB,ADR 内存自保),
 * 仅远程 StreamableHTTP/SSE 允许;stdio 需单独立项评审内存。
 */

export interface McpServerConfig {
  url: string
  name: string
}

/** 适配函数签名(未实现):远程 MCP server 的 tools → 本地 Tool 记录。 */
export type McpToolsAdapter = (cfg: McpServerConfig) => Promise<Tool[]>
