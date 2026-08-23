# 06 — changelog:内存快照/增量译制/定时预取

**What to build:** ADR-0005/0017 语义照搬。请求路径纯读内存快照(volatile 原子换新,零外呼零 LLM);node-cron 每 6h 预取刷新;启动先从快照表恢复(秒级可服务)再异步预热,失败沿用旧快照(最多旧 6h);内存空则同步兜底刷新一次,仍失败 500。译文按版本块原文 SHA-256 主键持久化,一版终身只译一次;增量检测纯算法零 token;译制失败记 warn 保持英文、下轮重试;refresh 与 translateVersions 互斥防并发重复译制。npm releasedAt 拉失败为 null,前端日期行降级「—」。端点行为以 api-contract.md 为准。

**Blocked by:** 04 — auth。

**Status:** done(实现随票 02-05 批次落地;2026-08-23 补勾,证据如下)

- [x] GET 端点返回已译版本 + npm 发布日期,形状照契约;releasedAt 失败时为 null —— changelog.test.ts「200 形状照契约」「releasedAt 成功路径」「null 不阻塞」
- [x] 重启后先从快照表恢复、秒级可服务,随后异步预热 —— 「重启恢复:loadFromDb 重建镜像零外呼零 LLM」;票 12 线上实证:预热 GitHub 超时降级沿用快照,端点 200 秒级
- [x] 同一版本二次刷新零 LLM 调用(SHA-256 持久化命中)—— 「块哈希全命中 → 零 LLM 调用」
- [x] 上游/LLM 失败降级语义:沿用旧快照或保持英文,不抛 500 —— 「译制失败保持英文重试」「定时刷新失败不空窗」「冷启动且拉取失败才 500」
- [x] 并发 refresh 与译制不产生重复翻译(互斥)—— 「并发互斥(Java synchronized 对应物)」
