# 08 — AI 底座最小骨架(tool 注册表 + agent loop)

**What to build:** 档位 B 骨架,无任何 HTTP 端点、无 DB。tool 注册表:集中单文件注册,handler 签名带 `userId` 上下文,zod 4 schema 序列化给网关。`runAgent` async 函数:非流式,默认 gpt-5-nano 可覆盖。防失控常量:步数上限 8;同一 tool 连续失败 2 次中止;超时 connect 10s / read 5min。MCP 仅 interface 预留:统一注册表抽象(`mcp:<server>:` 前缀防撞名),不装 client 包,stdio transport 默认禁用。Key 沿用 `AIHUBMIX_API_KEY`。纸面架构见 ai-platform.md。

**Blocked by:** 02 — Node 后端骨架(无端点无 DB,不依赖 schema/auth,可与 04-07 并行)。

**Status:** done

- [x] tool 注册表单测:注册、查找、schema 序列化
- [x] agent loop smoke:喂假响应跑通 tool-call 回灌;步数打满报错上抛不返半成品;同 tool 连续失败 2 次中止
- [x] 22 端点契约面零变化(骨架无 HTTP 入口)
- [x] 未引入任何 MCP client 实装包
