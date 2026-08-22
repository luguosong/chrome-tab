# AI 底座架构(设计落档 + 最小骨架)

- 对应票据:[issues/07-ai-platform-architecture.md](issues/07-ai-platform-architecture.md)
- 日期:2026-08-21
- 状态:**设计落档,未实装**。当前无任何 AI 消费者(票 06:系统零 AI 入口,AI 只可能存在于未来「扩展类型」图标内部);骨架边界以「首个 AI 图标立项时能直接长全」为准。

## 1. 定位

AI 底座 = Node 后端内的一小块内部设施:`src/ai/` 目录,含 tool 注册表、agent loop、MCP 适配 interface。执行层选型已由 [research/02](research/02-ai-execution-layer.md) 钉死:裸调 fetch + 自建注册表(~150 行 loop),零 LLM 框架;升级触发器见该调研第四节(Vercel AI SDK v7,流式 UI 需求出现时)。

## 2. tool 注册表

代码内注册,集中单文件(`src/ai/tools/index.ts` 逐条 import)——tool 总数预期个位数,集中一眼看全,不发明模块扫描。

```ts
// src/ai/registry.ts(骨架 ~20 行)
interface ToolCtx {
  userId: number          // 骨架阶段仅此一个字段;宁多一个参数,不改签名
}
interface Tool<I, O> {
  name: string
  description: string
  schema: ZodSchema<I>    // zod 4 自带 z.toJSONSchema,序列化给网关
  handler: (input: I, ctx: ToolCtx) => Promise<O>
}
register<I, O>(tool: Tool<I, O>): void
```

ctx 从第一天就带 `userId`:未来 AI 图标的 tool 多半要按用户读写数据,现在不留、将来要动所有 handler 签名。

## 3. agent loop

```ts
// src/ai/agent.ts(骨架 ~100–150 行,非流式)
runAgent(messages: Msg[], tools?: ToolRef[], opts?: { model?: string }): Promise<Msg>
// opts.model 默认 'gpt-5-nano',调用方可覆盖
```

- 形态:普通 async 函数。骨架阶段**无 HTTP 端点**;未来 AI 图标经自己的端点调它,定时触发(node-cron 调同一函数)仅画在图上、不实现。多轮会话载体与状态存储推迟到首个 AI 图标立项时(map「Not yet specified」)。
- 循环:发 messages+tools → 响应带 tool_calls 则逐个 dispatch 回注册表、结果以 `role:"tool"` 追加 → 否则返回。(spec 原判据 `finish_reason==="tool_calls"`;实装改判 `message.tool_calls` 存在性——兼容网关对 finish_reason 实现参差,语义等价且更稳健)
- 防失控常量(写死并注释):步数上限 **8**;同一 tool 连续失败 **2** 次即中止;read 5min 经 `AbortSignal.timeout()` 生效;connect 10s 为**预留常量,骨架未接线**(Node 原生 fetch 不分层超时,接线需装 undici dispatcher;首个真实 MCP/慢网消费者上线时接,此前由 read 5min 上界兜底,见 agent.ts ponytail 注释)。

## 4. MCP client 预留点

**统一注册表抽象**:MCP server 的 `listTools` 结果由一个适配函数转成本地 `Tool` 记录(name 加 `mcp:<server>:` 前缀防撞名,`callTool` 包成 handler),agent loop 的 dispatch 只查一张表、完全不感知 tool 来源。将来接外部 MCP server = 写适配函数,业务代码零改动。

```ts
// src/ai/mcp.ts(骨架阶段仅此 interface,不装 @modelcontextprotocol/client)
interface McpServerConfig { url: string; name: string }
async function mcpToolsToRegistry(cfg: McpServerConfig): Promise<Tool<any, any>[]>
```

硬约束:**stdio 子进程 transport 每常驻 30~80 MiB,默认禁用;仅远程 StreamableHTTP/SSE 允许,stdio 需单独立项评审内存**。首个真实 MCP server 进来时再 `npm i @modelcontextprotocol/client@2`(~10 MB/8 依赖,RSS≈0)。

## 5. 触发面与降级语义(只写设计,不实现)

- **读侧**:透传原文、永不空白(ADR-0005 先例)。任何一步失败抛原始响应/原文上浮,由调用方(AI 图标)决定透传形态。
- **写侧**:宁可不动、不可错写。写型 tool 的幂等/先读后写在各自 handler 内部保证;agent 层不代偿。
- **步数上限打满** → 报错上抛,不返回半成品(调用方无从判断完整性,半成品比报错危险)。
- **单个 tool 失败** → 错误文本以 `role:"tool"` 回喂模型一轮(自纠路径),连续 2 次失败即中止上抛(回喂无限循环 = 变相烧钱)。
- Key:沿用 `AIHUBMIX_API_KEY` 环境变量,不新建管理面。

## 6. 骨架清单(档位 B:loop 写完,MCP 留接口)

| 件 | 状态 |
|---|---|
| `src/ai/registry.ts` | 写完(~20 行)+ 注册表单测 |
| `src/ai/agent.ts` | 写完(~100–150 行)+ smoke 单测(喂假响应跑通 tool-call 回灌) |
| `src/ai/tools/index.ts` | 集中注册文件,骨架阶段为空表 + 一条注释 |
| `src/ai/mcp.ts` | 仅 interface,零依赖 |
| `@modelcontextprotocol/client@2` | 不装,首个真实 MCP server 时再引 |

骨架在 Node 迁移(票 08)落地后的 `backend-node` 仓库内实现;实装时若本档与现状冲突,以本档为准修订代码。
