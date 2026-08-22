# 02 AI 执行层选型

Type: research
Status: resolved

## Question

AI 执行层选型:**LangChain.js(v1) vs Vercel AI SDK vs Anthropic Agent SDK vs 裸调 OpenAI 兼容 fetch + @modelcontextprotocol/sdk**。评估轴:aihubmix(OpenAI 兼容网关)兼容性、MCP client 支持(HTTP/SSE 与 stdio)、tool/skill 注册表 ergonomics(我们要自建「每个小功能注册为一个 tool」的注册表)、agent 循环开销、内存增量、与 React/TS 前端共享类型的可能。给出推荐 + 理由 + 已知坑(如 gpt-5 系 temperature 被网关忽略之类网关行为)。

## Answer

推荐**裸调 fetch + `@modelcontextprotocol/client@2`(7 依赖)+ 自建 tool 注册表与 ~100–150 行 agent loop**,不引任何 LLM 框架——内存/依赖增量最小(实测对照:LangChain 25 包/88 MB/+137 MB RSS;Vercel AI SDK 15 包/25 MB/~38 MB RSS;裸调 ≈0),且 tool 注册表本就自建、changelog 已有零框架先例可平移。**LangChain.js v1 否决**(最重且网关有 streamUsage 坑);**Anthropic Agent SDK 硬不合格**(仅 Anthropic 协议接不上 aihubmix 的 OpenAI 兼容端点,捆绑 323 MiB 二进制 + 每 query 一个引擎子进程)。升级路径预留:**Vercel AI SDK v7**——做流式对话 UI 或流式 tool-call 聚合那天再引入。已知坑:gpt-5 系 temperature 网关强制忽略(lobehub#9327 实证)、`max_tokens` 弃用须用 `max_completion_tokens`、超时未文档化须自设、每模型 tool 支持可经 aihubmix Models API 机器核查。

详见 findings:[`.scratch/backend-rewrite/research/02-ai-execution-layer.md`](../research/02-ai-execution-layer.md)(含 /tmp 实测体积表、逐方案评估、网关坑清单与一手来源)。
