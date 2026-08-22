# 09 测试对齐策略

Type: grilling
Status: resolved
Blocked by: 08

## Question

测试对齐策略:Node 重写侧的测试怎么建——契约测试以 [`api-contract.md`](../api-contract.md)(含修正白名单)为基准逐端点断言?Java 现有测试(changelog Controller/Service/Slicer 三套等)哪些语义值得对应移植、哪些随 Java 一起下线?切换日的验证清单(数据对账 + 契约冒烟)怎么定?

## Answer

**2026-08-21 定版(用户 Q1–Q5 全按推荐批准;语义搬运底稿见 [test-align-map.md](../test-align-map.md))**:

1. **框架 = vitest**(与前端同 workspace,零新增;候选 node:test 否决)。
2. **契约测试形态**:HTTP 层 `app.request()`(Hono 免端口);DB 用内存 SQLite + 复刻 fixture 基线(3 页 / 26 图标 / 页容量 64)。
3. **粒度**:每端点 happy 形态 + 401 + 关键错误分支(B);**修正白名单 7 项各单独 positive+negative 双断言**——改动的语义最需被网包围。
4. **Java 移植**:语义全量重译(非 copy):纯逻辑(changelog 切片与增量零 LLM 去重、weather 解析与 gzip 摘头、page/icon 排序不变量、config 校验矩阵/孤儿 parentId 重映射)全部重写;**砍固定两块礼仪断言**(旧 JSON 形状字段 `exists` 断言、逐端点 401 wrapper)。
5. **切换日验证**:本机全量 vitest 全绿 = 切换硬条件(无 CI);服务器现场 `pnpm smoke`(登录链路 + config/changelog/weather/wallpaper 各一探 + 401 探针),失败即转 08「向前修复」。数据对账走 03 的 ETL 报告。

下游:08「A→D 执行清单」的 B1 规格已完整详细;frontier 清空,后续执行 session 可直接开工。
