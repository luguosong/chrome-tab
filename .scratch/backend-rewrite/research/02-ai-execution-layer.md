# 调研:AI 执行层选型

- 对应票据:`.scratch/backend-rewrite/issues/02-ai-execution-layer.md`
- 日期:2026-08-21
- 环境:Node 24.19.0 / npm 11.17.0;部署机 1.6 GiB RAM;LLM 走 aihubmix OpenAI 兼容网关(gpt-5-nano 先例见 ADR-0005/0017,Key 在 `AIHUBMIX_API_KEY`)
- 方法:四个并行 web research agent 查证一手来源(官方文档/npm registry/GitHub)+ 本机 /tmp 实测安装(`npm install` 真实体积与依赖数)+ 已安装包 dist 源码导出核验

## 结论速览(TL;DR)

1. **推荐:裸调(native fetch)+ `@modelcontextprotocol/client`(v2,7 个依赖)做 MCP client,自建 tool 注册表与 agent loop(约 100–150 行)。** 不引任何 LLM 框架。
2. **明确否决 LangChain.js v1**(最重:25 包/88 MB 磁盘/实测 +137 MB RSS,买来的 createAgent 循环我们自己 150 行就能写)与 **Anthropic Agent SDK**(硬不合格:只讲 Anthropic 协议、无法接 aihubmix 的 OpenAI 兼容端点、捆绑 323 MiB 原生二进制、每 query 一个引擎子进程、商业条款)。
3. **备选升级路径:Vercel AI SDK v7**(`ai@7` + `@ai-sdk/openai-compatible` + `@ai-sdk/mcp`,15 包/~25 MB/实测 ~38 MB RSS)——当「流式 tool-call 增量聚合」或「前端 useChat 流式 UI」成为真实痛点时再引入,一次依赖升级即可切换,不是单向门。
4. aihubmix 网关坑(已实证):gpt-5 系 `temperature` 被强制忽略(lobehub issue #9327 实存);`max_tokens` 已弃用须用 `max_completion_tokens`;每模型 tool calling 支持可用其 Models API 的 `tools` 标志机器可查;超时/keep-alive 完全未文档化——沿用现有 Java 侧 5 分钟 read timeout 自保。

## 一、实测数据(/tmp 真实 `npm install`,2026-08-21)

| 方案 | 安装的包 | node_modules | 包数 | 实测 RSS 增量 | 运行要求 |
|---|---|---|---|---|---|
| 裸 fetch + `@modelcontextprotocol/client@2` | MCP client 7 依赖 | ~10 MB | ~8 | ≈0(纯 fetch) | node >= 20 |
| `ai@7.0.73` + `@ai-sdk/openai@4.0.45` + zod | + `@ai-sdk/openai-compatible`、`@ai-sdk/mcp` 后共 15 包 | 24→25 MB | 12→15 | ~38 MB(agent 建好实测) | **node >= 22,ESM-only** |
| `langchain@1.5.10` + `@langchain/openai`(自动带入 core 1.2.9 / langgraph 1.4.12 / openai 7.5.0 / langsmith / js-tiktoken) | 22 包;+ `@langchain/mcp-adapters` 后 120 包 | 88 MB(→107 MB) | 22(→120) | **~137 MB**(180.8 MB vs 裸 Node 43.5 MB) | node >= 22 |
| `@anthropic-ai/claude-agent-sdk@0.3.238` | 内含平台原生二进制(339 MB) | **366 MB** | 107 | 引擎子进程另计(无官方数字,风险高) | node >= 18,ESM-only |
| `@modelcontextprotocol/sdk@1.30.0`(1.x 单体) | express/hono/jose/cors 是**硬依赖** | 25 MB | 91 | — | node >= 18 |
| `openai@7.5.0`(官方 SDK,供对照) | 零依赖 | 21 MB | 1 | — | — |

辅助事实:

- Node 24 内置 `fetch`/`ReadableStream`/`TextDecoderStream`,但**无全局 `EventSource`**(且 OpenAI 流式是 POST,EventSource 本来也用不上)——SSE 解析要么 ~20 行手写,要么 `eventsource-parser`(微型单包)。
- 本机核验 `ai@7.0.73` dist:导出 `ToolLoopAgent`、`tool`、`generateText`、`streamText`、`stepCountIs` 等;**核心包已不含任何 MCP 代码**(v4/v5 的 `experimental_createMCPClient` 移去了独立包 `@ai-sdk/mcp`)。
- 前端现状:React 18 + react-query,**无 zod、无 openapi codegen**;「与前端共享类型」目前就是手写 TS interface,四个方案都不阻塞。

## 二、逐方案评估

### 1. 裸调 fetch + @modelcontextprotocol/sdk —— 推荐 ✅

- **aihubmix 兼容**:项目已有先例——`ChangelogConfig.translator()`(`backend/.../changelog/ChangelogConfig.java:97-118`)纯 POST `/chat/completions` + Bearer,~35 行。迁 Node 后 native fetch 只会更短。baseURL/model/key 全自持,响应原样在手,**与「LLM 失败透传原始数据」哲学天然契合**(框架封装层越厚,降级路径越难写)。
- **MCP client**:官方 TS SDK 已拆 v2——`@modelcontextprotocol/client@2.0.0`(2026-07-28 新 spec,MIT/Apache-2,node >= 20,仅 7 依赖:core/jose/pkce-challenge/eventsource-parser/zod/cross-spawn/eventsource)。三种 client transport(stdio / SSE / StreamableHTTP)均为一等公民、无 experimental 标签,带 OAuth 指南。连接 + `listTools` + `callTool` 官方最小示例 ~8 行。**注意:别装 1.x 单体 `@modelcontextprotocol/sdk`(91 包,express/hono 硬依赖);v1 仍在出 patch 但已锁旧 spec。**
- **tool 注册表 ergonomics**:注册表本来就是自建(`tool(name, desc, zodSchema, handler)` 一条记录),裸调不影响;zod schema 单独存一层即可与前端共享(想共享时再加 zod,现在前端没有)。
- **agent loop 开销**:唯一真实成本。多步 tool-use loop ≈ 100–150 行:while 循环 + 把 `choices[0].message.tool_calls` 逐个 dispatch 回注册表 + 结果以 `role:"tool"` 追加。非流式场景(后台任务、译制)下没有 SSE 麻烦;**流式 + tool call 混合**时 tool-call `arguments` 以 delta 分片到达、需聚合——这是唯一值得警惕的手写代码,若做流式建议非流式拿 tool call、流式只用于最终文本(两段式),或直接触发升级路径(见下)。
- **内存**:≈0(Node 24 原生 fetch)+ MCP client 若干 MB。1.6 GiB 机器上最省。
- **共享类型**:中立——TS interface / zod 均可,无约束。

### 2. Vercel AI SDK v7 —— 备选升级路径(条件引入)

- **版本现状**:`ai@7.0.73`(7.0.0 于 2026-06-25 发布;5.0 2025-07、6.0 2025-12——**一年三个 major,API 改名频繁**:`parameters`→`inputSchema`、`system`→`instructions`、`maxSteps`→`stopWhen`、`fullStream`→`stream`)。
- **aihubmix 兼容**:⚠️ `@ai-sdk/openai` 的 `openai(model)` 默认走 **Responses API**;网关场景必须 `openai.chat(model)` 或直接用 `@ai-sdk/openai-compatible`(专为 `/chat/completions` 网关设计,实测可跑通,baseURL 指向 `https://aihubmix.com/v1`)。旧的 `compatibility:'compatible'` 选项已删除。**要求 node >= 22 + ESM-only**(新写后端无碍)。
- **MCP client**:独立包 `@ai-sdk/mcp@2.0.34`,`createMCPClient` 已去 `experimental_` 前缀;http/sse 内建 transport + OAuth(`authProvider`);stdio 走 `Experimental_StdioMCPTransport` 或官方 MCP SDK;不拉 `@modelcontextprotocol/sdk`。
- **tool 循环**:`generateText`/`streamText` + `stopWhen: stepCountIs(n)`(默认 20 步)自动执行 tool 并回灌;`ToolLoopAgent` 最小 ~10 行。tool 定义 = 对象键名 + `inputSchema`(zod),与自建注册表可平滑映射。
- **内存/体积**:15 包/25 MB/~38 MB RSS,本机上无压力。
- **前端协同**:最大亮点——`@ai-sdk/react` 的 `useChat` + 后端 `createAgentUIStream` 成套流式 UI 方案;zod tool schema 可直接被前端复用。
- **判断**:买的是「SSE 解析 + tool-call delta 聚合 + 循环 + MCP 握手」这 ~200 行麻烦代码。这些麻烦在「后台译制 + 少量 agent 功能」阶段不痛;**做对话式流式 UI 的那天会痛**——那时引入,成本是 15 个依赖与一次 ESM 迁移,注册表逻辑可原样搬运。

### 3. LangChain.js v1 —— 否决 ❌

- 现状:`langchain@1.5.10`(1.0 于 2025-10 发布,确实比 0.x 瘦了);`createAgent` 自动跑 tool 循环(~20 行);`ChatOpenAI` 用 `configuration.baseURL` 指网关;`@langchain/mcp-adapters@1.1.4` 支持 stdio/http/sse。LangSmith 追踪默认关(须 `LANGCHAIN_TRACING_V2=true` 才启用,`langsmith` 依赖在但惰性,无匿名上报)。
- 否决理由:
  1. **最重**:25 包/88 MB/+137 MB RSS——四个方案里内存增量最大,与「轻量 + 省内存」的立项目标直接相悖(map.md 明文:「为『框架成熟』而引框架:LangChain.js 只有在 AI 执行层 research 证明必要时才进栈」——本调研结论是:不必要)。
  2. **网关坑**:流式时默认自动发送 `stream_options: {include_usage: true}`(`streamUsage` 默认 true),不支持该参数的代理/网关直接炸,须显式 `streamUsage: false`;官方文档自认「路由器/代理的供应商特有字段可能不被提取或保留」。
  3. MCP client 默认无状态:每次 tool 调用新建 MCP 会话再拆掉,远程 HTTP server 上是每次调用的握手开销。
  4. 用户态度已声明「非硬需求,觉得成熟而已」——v1 确实比 0.x 成熟,但成熟的是我们不需要的部分(durable state、middleware 生态)。

### 4. Anthropic Agent SDK —— 否决(硬不合格)❌

- 本体是「捆绑 Claude Code 引擎的子进程 wrapper」:平台二进制随 npm optional deps 进来(linux-x64 包**解压 323 MiB**,实测 node_modules 366 MB);每次 `query()` 起一个完整引擎子进程。1.6 GiB 机器上不可接受。
- **协议死锁**:引擎只讲 Anthropic Messages / Bedrock / Vertex 三种 Claude 方言,**无 OpenAI Chat Completions 形态**;官方明文「不支持经任何网关把 Claude Code 路由到非 Claude 模型」。我们只有 aihubmix 的 OpenAI 兼容端点 + gpt-5-nano——接不上。(aihubmix 另有 `/v1/messages` Anthropic 兼容 Beta 端点可全模型路由,但 Anthropic 不支持这种用法,且 RAM/磁盘成本不变。)
- 认证必须 Anthropic API key 或 Bedrock/Vertex/Foundry;许可为 Anthropic 商业条款(非 MIT/Apache)。
- 唯一亮点(进程内 `tool()` 回调 + stdio/HTTP/SSE MCP)不足以翻盘。若未来开 Anthropic 账号专跑 Claude 模型再议。

## 三、aihubmix 网关已知坑(全部一手来源实证)

1. **gpt-5 系 `temperature` 被忽略**:lobehub/lobe-chat#9327 实存(2025-09-19,设 0.5 实际发 1,无修复关闭)。aihubmix 自己的文档反而把 temperature 当普通参数写(0–2)——该行为与 OpenAI gpt-5 上游「仅支持默认 temperature」一致,非网关私有 bug。ADR-0005 已录:确定性不靠低温、靠 Prompt 明文约束。`top_p` 同理。
2. **`max_tokens` 已弃用**且「与 o 系模型不兼容」;用 `max_completion_tokens`(含推理 token)。gpt-5 系走 `reasoning_effort` 控制推理深度。
3. **tool calling 官方支持**:Chat Completions 文档化 `tools`/`tool_choice`/`parallel_tool_calls`(默认 true)、`response_format` 含 `json_schema` 结构化输出;/v1/responses(Beta)也有 tool calling。**每模型能力可用 Models API 的 `tools`/`function_calling` 标志机器核查**(定价页 gpt-5 nano 档当前 ~$0.2/M 进、~$1.25/M 出)——上线前先查一次 gpt-5-nano 的标志位。
4. **错误语义**:429=频率超限;503=「被供应商限流,联系客服提并发」;403 `insufficient_user_quota`=余额耗尽,403 还覆盖 key 的 IP 段限制与「该 key 未授权此模型」。**无公开 RPM/TPM 数字表**(按账户层级,可申请提额)。
5. **超时与流式 keep-alive 完全未文档化**——沿用 ADR-0017 的自保:显式 connect 10s / read 5min(Java 侧 `ChangelogConfig.timed()` 已如此,Node 侧 `AbortSignal.timeout()` 等价)。
6. 备用面:同域名 `/v1/messages`(Anthropic 协议,Beta,200+ 模型全路由)与备用域名 `api.inferfer.com`;官方还有一个 MCP 端点(目前仅图像生成,能力扩张中)——都不改变本选型。

## 四、决策与落地要点

**采用:裸调 fetch + `@modelcontextprotocol/client@2` + 自建 tool 注册表。**

- tool 注册表形态(自建,~20 行核心):`registry.register(name, description, zodSchema, handler)`;发给网关的 `tools` JSON Schema 由 zod 序列化(zod 4 自带 `z.toJSONSchema`,不必引 `zod-to-json-schema`)。
- agent loop(非流式,~100 行):while → 发 messages+tools → 若 `finish_reason==="tool_calls"` 逐个 dispatch、结果追加 `role:"tool"` → 否则返回。步数上限写死(如 8)。
- 降级哲学延续:任何一步失败抛原始响应/原文上浮,由调用方决定透传(与 changelog 现行为一致)。
- 切换触发器(写下来,防止将来凭感觉摇摆):出现下列任一条 → 引入 Vercel AI SDK v7(不是 LangChain):a) 需要边生成边推前端的对话式 UI;b) 必须在流式响应里聚合 tool-call 增量;c) 需要多 provider 热切换(AI SDK gateway)。

## 附:一手来源

- AI SDK:`ai`/`@ai-sdk/openai-compatible`/`@ai-sdk/mcp` npm registry 与 https://ai-sdk.dev(docs/introduction、providers/ai-sdk-providers/openai、ai-sdk-core/tools-and-tool-calling、mcp-tools、migration-guide-7-0)
- LangChain:https://www.langchain.com/blog/langchain-langgraph-1dot0 、https://docs.langchain.com/oss/javascript(langchain/quickstart、integrations/chat/openai、langchain/mcp、langchain/models)+ 本机安装 1.5.10 的 dist 核验(streamUsage 逻辑、isTracingEnabled 逻辑)
- Anthropic Agent SDK:https://code.claude.com/docs/en/agent-sdk/typescript.md 、quickstart、llm-gateway-protocol.md、llm-gateway.md + npm registry(`@anthropic-ai/claude-agent-sdk@0.3.238`、`...-linux-x64` 339 MB)
- aihubmix:https://docs.aihubmix.com/cn/api-reference/openai-compatible/create-a-chat-completion 、/cn/FAQs/HTTP-Codes 、/cn/api/Models-API 、/cn/api/Anthropic-Compatible 、https://github.com/lobehub/lobe-chat/issues/9327
- MCP TS SDK:https://github.com/modelcontextprotocol/typescript-sdk 、https://ts.sdk.modelcontextprotocol.io/v2/clients/connect.html 、npm `@modelcontextprotocol/client@2.0.0` / `@modelcontextprotocol/sdk@1.30.0`
- 本仓库先例:`docs/adr/0005-changelog-llm-translation-proxy.md`、`docs/adr/0017-changelog-incremental-translation-persistence.md`、`backend/src/main/java/com/personal/newtab/changelog/ChangelogConfig.java`
