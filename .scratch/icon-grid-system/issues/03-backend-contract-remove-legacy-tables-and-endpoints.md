# 03 — 后端 contract:移除旧 nav_links/stock_watches 表与端点

**What to build:** 完成聚合接口的 contract 阶段。前端已切换到新 Icon 模型(02 完成后)后,删除旧的领域模型:`nav_links` 与 `stock_watches` 表、对应 JPA 实体、repository、controller,以及 `GET /api/config` 中的 `navLinks`/`stockWatches` 字段。完成后代码库不再有遗留的双轨字段,聚合接口只返回 `{pages, icons, setting}`。

遵循 ADR-0001。

**Blocked by:** 02 — 前端基于 Icon 模型渲染默认页(02)(前端必须先停止消费旧字段)

**Status:** done(提交 `01b11e9`;本会话核查:V3 迁移 DROP 两表、NavLink/StockWatch 实体已无、前端无遗留引用 + 后端 BUILD SUCCESS,运行态待手测)

- [x] Flyway 迁移:`DROP TABLE nav_links, stock_watches`(在确认前端不再读取后)
- [x] 删除 `NavLink`/`NavLinkRepository`/`NavLinkController`/`NavLinkResponse`
- [x] 删除 `StockWatch`/`StockWatchRepository`/`StockWatchController`/`StockWatchResponse`
- [x] `ConfigResponse` 移除 `navLinks`/`stockWatches` 字段,只保留 `pages`/`icons`/`setting`
- [x] 前端 `lib/types.ts` 清理对 `NavLink`/`StockWatch` 的引用,`Config` 类型只保留 `pages`/`icons`/`setting`
- [x] 前端清理对 `useAddNavLink`/`useDeleteNavLink`/`useAddStockWatch`/`useDeleteStockWatch` 等旧 mutation hook 的引用(若仍残留)
- [x] 后端测试更新:确认聚合接口只返回新字段,旧端点 404
- [x] 验证:前端开屏正常,无控制台 404/字段缺失错误
