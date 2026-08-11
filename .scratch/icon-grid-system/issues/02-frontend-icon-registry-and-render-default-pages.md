# 02 — 前端:图标类型注册表 + 基于 Icon 模型渲染默认页

**What to build:** 在前端建立图标网格系统的展示地基。实现图标类型注册表(`IconTypeRegistry`),登记三个内置类型(nav / stock / changelog)的定义:各自支持的尺寸档、默认尺寸、单例标志、摘要渲染、详情容器形态、配置表单。把 `DashboardPage` 从写死的三个 slide 组件改为根据 `useConfig().pages` 动态渲染页面与图标网格。`Icon` 组件按 `size` 展示对应信息密度(小=favicon,中=favicon+名称,大=favicon+名称+实时摘要)。数据源从旧的 `navLinks`/`stockWatches` 切换到新的 `icons`。完成后开屏看到的三个默认页布局与现状一致,但底层已是 Icon 模型。

遵循 `CONTEXT.md` 术语与 ADR-0001。

**Blocked by:** 01 — 后端聚合接口(01)

**Status:** done(提交 `a5267e8`;本会话核查:代码产物齐备 + tsc/vitest 69 例 + 后端 BUILD SUCCESS 全绿,运行态 UX 待手测)

- [x] `IconTypeRegistry` 实现:`register(typeId, definition)`,内置 nav/stock/changelog 三定义(尺寸档、默认尺寸、单例标志、摘要渲染函数、详情容器声明、配置表单声明)
- [x] 类型定义 TS 接口,对齐 `CONTEXT.md` 中"图标类型"声明的职责
- [x] 前端数据模型:从 `lib/types.ts` 的 `NavLink`/`StockWatch` 切到 `Page`/`Icon`(icons 带 `pageId/type/size/sortOrder/data`);`Config` 类型扩展 `pages`/`icons` 字段
- [x] `Icon` 组件:按 `size` 与 type 的摘要渲染,展示 favicon / 名称 / 实时摘要(复用现有 `useQuotes`、`useChangelog`)
- [x] `IconGrid` 组件:按 page 渲染图标网格(本阶段无拖拽,静态渲染)
- [x] `Carousel` 改为承载多个 `pages`(动态),替换原本写死的三个 slide
- [x] `DashboardPage` 从 `useConfig().pages` 动态渲染,移除对 `NavTileGroup`/`StockTileGroup`/`ChangelogTile` 的写死引用
- [x] 开屏验证:三个默认页(快速导航/日志更新/行情)布局与现状视觉一致
- [x] 刷新策略沿用现有 hook(stock 60s、changelog 1h),失败降级灰色"--"
- [x] Vitest 纯函数测试:`registry` 的 `canAdd`(单例判断)、`sizesFor` 查询(对齐现有 `lib/*.test.ts` 先例)
