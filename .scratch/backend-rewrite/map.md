# Wayfinder map: 后端重造(Node + SQLite + AI 底座)

## Destination

一份锁定的后端重造决策包:chrome-tab 后端从 **Java + MySQL 全迁到轻量 Node.js + SQLite**;API 契约对前端冻结不变、线上数据无缝迁移;含 AI 执行层选型与 **AI 底座纸面架构(设计落档 + 最小骨架,MCP client 仅预留,首个 AI 图标立项时再长全)**;附滴答清单图标(纯传统扩展类型)规格。走到头 = 后续执行 session 可以直接开工、无需再做任何决策。

## Notes

- 领域词汇以根 `CONTEXT.md` 为准;讨论中用「图标/页面/格子/布局设置」等正名。
- 工作每张 ticket 前调用 Skill:grilling + domain-modeling。
- **已定前提**(2026-08-21 charting 会话钉定,不再重议):
  - 运行时:**全迁 Node**,不留 Java、不上 Node 边车(双后端共存 200 MiB+ 反而更重,个人项目的复杂度陷阱)。
  - 存储:意向 **MySQL → SQLite**,坑位待「SQLite 适配与数据迁移面」research 验证。
  - **skill** = 自建后端 tool 注册表:每个后续小功能注册为 agent 可调用的 tool;**不是** Claude Code 式 markdown 指令包。
  - **MCP** = client 方向起步(后端调外部 MCP server);不做 MCP server 对外暴露。2026-08-21 起仅设计预留、不实装。
  - **前端不动**:API 契约冻结,`frontend/` 零改动。
  - 目的地形状 = 决策包(spec),不是完成迁移本身。
  - **AI 消费面**(2026-08-21 票 06 钉定,同日二次修正):系统(新标签页逻辑)零 AI 入口;AI 能力只可能存在于未来「扩展类型」图标的内部(自然语言入口那一段),图标其余部分是传统逻辑。**当前无任何 AI 消费者**——底座降级为设计落档 + 骨架,首个 AI 图标立项时再长全。
- 服务器事实(2026-08-21 实测,ssh tab):1.6 GiB RAM,available ~987 MiB;chrome-tab-backend 136 MiB、mysql 68 MiB、caddy 13 MiB;swap 已用 204 MiB(系统历史压力,非 backend 单点)。
- AI 网关事实:aihubmix OpenAI 兼容网关 + `gpt-5-nano`(`AIHUBMIX_API_KEY` 环境变量);gpt-5 系 temperature 被网关忽略(ADR-0005)。changelog 译制是现有 LLM 功能先例(ADR-0005/0017)。
- 用户偏好:轻量化优先、相同功能下省内存;「如果需要改造就彻底改造」;最简可行。
- 部署:docker compose(caddy + backend + mysql),发布流程见 deploy skill;教训:ADMIN_* 仅首启生效,改线上密码须直接 UPDATE users 表。

## Decisions so far

- [API 契约冻结清单](issues/05-api-contract-freeze.md) — 22 端点全量契约落档 [api-contract.md](api-contract.md)(含 LWW/config_version 镜像、changelog 快照降级语义);修正白名单 7 项获批(ping 删、状态码 201/204 语义化、wallpaper 按天、move toIndex、reorder 新序、icons PATCH 校验、logout 幂等)——全部「实现兑现既有声明」、前端零改动;Java 不回修,Node 直接实现修正后语义;04 同步勘误字段名 `status` + 修订拦截面。
- [auth 迁移语义冻结](issues/04-auth-migration.md) — 考古推翻预设:现状无 JWT,是 Tomcat 内存 session;Node 侧改 SQLite sessions 表(TTL 30d,今后重启不掉线;切换日本身仍需登录一次);bcrypt `$2a$` 哈希原样迁移零重置;端点/响应体/`JSESSIONID` 属性/拦截面冻结清单已立;空库 seed 语义照搬;jose/jsonwebtoken 选型消解。
- [SQLite 适配与数据迁移面](issues/03-sqlite-migration.md) — 可行、零硬阻塞;弃两步走,改「数据先行 ETL 迁 SQLite 并对账、切换日只换容器」;备份用每日 VACUUM INTO;Node 容器须保持 UTC 保 LWW 排序。
- [AI 执行层选型](issues/02-ai-execution-layer.md) — 裸调 fetch + `@modelcontextprotocol/client@2` + 自建 tool 注册表(~100–150 行 agent loop),零框架;LangChain.js 实测否决(25 包/88 MB/+137 MB RSS 且网关有坑);升级路径预留 Vercel AI SDK(流式 UI 需求出现时)。
- [Node 栈选型与内存 PoC](issues/01-node-stack-poc.md) — Hono 4 + better-sqlite3(WAL) + Kysely + jose + bcryptjs + node-cron v4;实测 87~101 MiB 达标(替代现 Java+MySQL 204 MiB);drizzle(ESM 入口 import 即 +150 MiB)与 Prisma 7(125 MiB)实测否决;单镜像 serveStatic 增量 ≈ 0,类型共享用 pnpm workspace + `shared/` 包双端直引 TS 源。
- [第一批 AI 小功能 → 无;滴答清单图标纯传统](issues/06-first-ai-features.md) — 框定推翻:系统零 AI 入口,AI 只可能在未来「扩展类型」图标内部;二次审议再推翻「验收样例」:滴答清单图标定版**纯传统**(直调滴答 API 复刻天气模式,零 AI——逐项复核后 AI 增值仅剩自然语言入口的交互形态,非能力);AI 底座随之降级为**设计落档 + 最小骨架**(MCP client 仅预留),首个 AI 图标立项再长全;滴答规格(单例、`DIDA_API_TOKEN` 走 .env、摘要=今日到期未完成数按需拉、详情容器列表+勾选+表单建任务)随决策包落档、Node 迁移后实现。
- [AI 底座架构](issues/07-ai-platform-architecture.md) — 纸面架构落档 [ai-platform.md](ai-platform.md):统一 tool 注册表(集中单文件注册,handler 带 `userId` ctx;MCP 经适配函数转本地记录、loop 不感知来源,stdio 默认禁用仅允许 HTTP/SSE);`runAgent` async 函数、步数上限 8/连续失败 2 中止/10s+5min 超时全为防失控常量;骨架档位 B——registry+loop(~170 行)写完配单测、MCP 仅 interface 不装包,实装归 Node 迁移后 `src/ai/`;降级=读透传原文/写宁可不动、打满报错不返半成品、tool 失败回喂一轮即止;ADR 待骨架实装时再评估。
- [迁移执行策略](issues/08-migration-strategy.md) — **big bang 定版、无回滚彻底清除**:feature branch 重写(期间 Java 冻结),切换成功即删服务器 mysql 全家(容器/镜像/卷)+ 旧 backend 镜像 + Java 代码(`backend/` 路径由 Node 沿用),唯一保留物 = 清卷前终版 mysqldump 文件(数据是唯一不可再生物);切换日流程 = 停旧 → dump 存档 → 重跑全量 ETL(秒级,提前 ETL 只是演练,零增量同步代码)→ 起新容器;caddy 零改动、deploy skill 同 session 更新、无切换窗口(停机几分钟);A→D 执行顺序清单落票内,**09 解锁成 frontier 唯一票**。
- [测试对齐策略](issues/09-test-alignment.md) — vitest + 契约测试 HTTP 层 `app.request()`(免端口、内存 SQLite fixture 基线);粒度 = 每端点 happy+401+关键错误分支,修正白名单 7 项各 positive/negative 双断言;Java 14 套件语义全量重译(砍旧 JSON 影子断言 + 逐端点 401),底稿 [test-align-map.md](test-align-map.md);切换验证 = 本机全量 vitest 绿 + 服务器 pnpm smoke(登录/键端点/401 探针);frontier 清空。

## Not yet specified

- agent 会话载体与状态存储(请求-响应 vs 多轮对话、存哪)——推迟到首个 AI 图标立项时(当前无消费者,底座仅纸面设计)。

## Out of scope

- **Next.js 全栈重构**(2026-08-21 评估否决:容器数省不了——Caddy 必留做 TLS;Next.js 运行时更重;纯客户端 SPA 无 SSR 价值)。其真实诉求「单部署单元 + 类型共享」以轻替代落地:@fastify/static 服务前端构建产物 + shared types 包,已并入「Node 栈选型与内存 PoC」。
- `frontend/` 的任何重写/重构(契约冻结,前端零改动)。
- 重定向扩展(Chrome extension)的任何改动。
- 后端作为 MCP server 对外暴露能力(若未来要做,另开 effort)。
- 为「框架成熟」而引框架:LangChain.js 只有在 AI 执行层 research 证明必要时才进栈。
- **AI 底座全套实装**(agent loop 常驻运行、tool 注册表运行时、MCP client 实装)——2026-08-21 票 06 二次审议钉定:无消费者不建,设计落档 + 骨架为止;首个 AI 图标立项时作为新 effort 长全。
