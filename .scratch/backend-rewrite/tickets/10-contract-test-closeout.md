# 10 — 契约测试收口(22 端点全量矩阵)

**What to build:** 切换硬前置。以 api-contract.md 为唯一事实源,主 seam = HTTP 层 `app.request()` 契约测试(Hono 免端口),逐端点补齐粒度 B 矩阵:每端点 happy 形态 + 401 + 关键错误分支;修正白名单 7 项各 positive+negative 双断言。DB fixture = 内存 SQLite + 复刻 seed 基线(3 页 / 12 NAV / 1 CHANGELOG / 13 STOCK,页容量 64);外部上游(和风/必应/npm/LLM 网关)以注入的假 fetch/固定 fixture 替身。Java 测试语义重译按 test-align-map.md 底稿:保留 changelog 切片与增量零 LLM 去重、weather gzip 摘头与解析降级、page/icon 排序不变量、config 校验矩阵与孤儿 parentId 重映射;砍掉 Spring 装配断言、旧 JSON 影子断言、逐端点 401 wrapper。

**Blocked by:** 05 — pages/icons/layout CRUD + config;06 — changelog;07 — weather/wallpaper。

**Status:** done(2026-08-22,commit 见 backend-rewrite 分支)

- [x] api-contract.md 22 端点逐条断言全绿,无跳过项(21 live 端点 + ping 以 404 收口)
- [x] 修正白名单 7 项各 positive+negative 双断言齐备
- [x] test-align-map.md 保留重译清单全覆盖
- [x] 本机全量 vitest 全绿(切换硬条件,无 CI;141 例,tsc 零错误)
