# 05 API 契约冻结清单

Type: grilling
Status: resolved

## Question

API 契约冻结清单:从代码提取前端消费的全部 `/api` 端点与响应形状(auth、pages、icons、layout、config aggregate、changelog、weather、wallpaper),作为迁移的**不变契约**——包括行为语义(如 changelog 译制失败透传英文原文的降级)。并 grilling:哪些端点**允许借机修正**(已知不合理的设计)vs 必须冻结。产出契约清单文档 + 修正白名单。前端零改动是硬边界。

## Answer

**产出:[`api-contract.md`](../api-contract.md)(22 端点全量契约底稿 + 已批修正白名单)**,作为工单资产链接。

**冻结面**(除白名单外一切逐字照搬):大写枚举 wire、各端点多返回的响应体、weather 坐标双表示、`NON_NULL` 省略字段语义(Node 序列化须**省略**而非置 null)、401 双形态(凭错带 body / 未认证空体,各有前端消费场景)、ErrorResponse 字段名 `status`;changelog 内存快照/降级语义(ADR-0017 译制失败透传英文原文、6h 定时、SHA-256 一版一行)全文照搬;config 的 LWW/config_version 镜像语义(ADR-0006)照搬;config 排序承诺升格为显式契约(pages 按 `sortOrder,id`、icons 按 `pageId,sortOrder,id`);stock 前端直连 eastmoney 格局不变。auth 三端点已由 issues/04 冻结,该工单已同步**勘误字段名笔误(`code`→`status`)+ 修订拦截面**(放行面改为 login+logout、ping 删)。

**修正白名单(2026-08-21 用户批准,7 项,全文见 api-contract.md 白名单节)**:① 删 `GET /api/ping`;② 建成功 201 / 删 204 / 动作 200 状态码语义化;③ wallpaper 缓存落地注释声称的按天失效;④ move 入组分支尊重 `toIndex`;⑤ reorder 按新序返回(静默跳过保留);⑥ `PATCH /api/icons/{id}` 补参数校验;⑦ logout 幂等化入放行面。入选原则:**全部为「让实现兑现既有声明/对齐既有约定」**,前端零改动(`client.ts` 只判 `res.ok` + 读 `message`,逐项核实无感)。**Java 侧不回修,Node 直接实现修正后语义,切换日起生效。**

**方法**:22 端点由 subagent 双侧提取(后端 8 Controller/record ↔ 前端 api/hooks/context 消费点),得 17 条可疑候选,7 项入白名单、其余照搬;ping 删除前查证部署层无依赖(compose healthcheck 是 MySQL 容器自身的 `mysqladmin ping`,backend 未配 healthcheck,Caddy 不引用)。

**下游影响**:工单 08(迁移策略)解锁;fog「测试对齐策略」毕业为工单 09(契约测试以 api-contract.md 为基准),blocked by 08。
