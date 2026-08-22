# 07 AI 底座架构

Type: grilling
Status: resolved
Blocked by: 02

## Question

AI 底座架构:skill 注册表的形态(代码内注册 vs 声明式配置文件)、MCP client 接入形态(远程 HTTP/SSE 优先 vs stdio 子进程——stdio 每个常驻 30~80 MiB,1.6 GiB 机器上的取舍)、agent 执行的触发面(前端请求 / 定时 / 两者)、Key 管理沿用 `AIHUBMIX_API_KEY` 环境变量、失败降级语义(参照 ADR-0005 的「透传原文、永不空白」)。产出架构小图 + tool 注册表接口草案。依赖 AI 执行层选型的结论。

2026-08-21 票 06 补充锚点(首个真实消费者已定):**滴答清单图标**。待决接入形态三分叉——后端 spawn `@suibiji/dida-cli` 子进程 vs 直连滴答 Open API vs import 包编程 API(CLI 本质是 Open API 的壳);认证走 API 口令(`DIDA_API_TOKEN` 进 .env);命令面 `project list` / `task create` / `task complete` / `task delete`;tools = `list_projects`/`list_tasks`/`create_task`/`complete_task`;触发面至少含详情容器按需交互(摘要拉取为普通取数、不过 agent);写入型降级 = 「宁可不动、不可错写」。

2026-08-21 票 06 **二次修正后的范围缩减**:滴答清单图标定版纯传统(零 AI),上文锚点全部作废——dida 接入路径由实现 session 自行决定,tools 清单与写入降级不再归属本票。底座整体降级为「设计落档 + 最小骨架」,本票问题收窄为**纸面架构**:

- tool 注册表的接口形态草案(代码内注册的签名长什么样,~150 行 agent loop 骨架的边界);
- MCP client 的预留点(什么接口形状能让将来接入外部 MCP server 时不动业务代码);
- 触发面与降级语义只写设计、不实现(读侧「透传原文、永不空白」/ 写侧「宁可不动、不可错写」)。

产出:一页设计说明(决策包的一节),无代码验收——骨架边界以「首个 AI 图标立项时能直接长全」为准。

## Answer

2026-08-21,六问一轮全按推荐钉定,设计落档 [ai-platform.md](../ai-platform.md)(决策包资产,与 api-contract.md 并列)。要点:

- **tool 注册表**:代码内注册、集中单文件 `tools/index.ts`;`Tool { name, description, schema(zod), handler(input, ctx) }`,ctx 从第一天就带 `userId`(宁多一个参数,不改签名)。
- **MCP 预留点**:统一注册表抽象——MCP `listTools` 经适配函数转本地 Tool 记录(`mcp:<server>:` 前缀),agent loop 只查一张表、不感知来源,接外部 server 时业务零改动;硬约束 stdio 子进程默认禁用(30~80 MiB/常驻),仅 StreamableHTTP/SSE,stdio 须单独立项;`@modelcontextprotocol/client@2` 骨架阶段不装。
- **run 边界**:`runAgent(messages, tools?, opts?)` 普通 async 函数,`opts.model` 默认 gpt-5-nano;步数上限 8、同一 tool 连续失败 2 次中止、connect 10s / read 5min——全部写死为防失控常量;骨架阶段无 HTTP 端点,定时触发仅画图;多轮会话仍留 fog。
- **骨架档位 B**:registry(~20 行)+ agent loop(~150 行)写完并配单测(首个 AI 图标立项时是已验证代码,不是纸面),MCP 仅 interface 零依赖;实装落在 Node 迁移(票 08)后的 backend-node 仓库 `src/ai/`。
- **降级**:读侧透传原文永不空白(ADR-0005)、写侧宁可不动不可错写(幂等归 handler);步数打满报错上抛不返半成品;tool 失败回喂模型一轮自纠、连续 2 次即止;Key 沿用 `AIHUBMIX_API_KEY`。

ADR 判断:本票是 scratch 决策包内的纸面设计,设计文件自身承担决策记录;待 Node 迁移落地、骨架实装时再评估是否立 ADR。
