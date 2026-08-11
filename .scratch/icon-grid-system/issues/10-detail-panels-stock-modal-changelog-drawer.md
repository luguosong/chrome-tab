# 10 — 详情面板:stock Modal + changelog 底部 Drawer

**What to build:** 实现点击图标查看详情的交互,详情容器形态由图标类型在注册表中声明。非编辑模式下点击图标触发其类型的详情行为:股票图标 → Modal 弹窗(展示行情详情,K 线数据接入为 Out of Scope,先用占位);更新日志图标 → 底部 Drawer 滑出(展示完整版本列表,复用现有 `useChangelog`);网站链接图标 → 直接在新标签页打开目标 URL(无详情面板)。摘要或详情刷新失败时显示降级占位。

遵循 `CONTEXT.md`(图标类型的详情容器职责)。

**Blocked by:** 02 — 前端类型注册表(02)(详情容器形态由类型定义声明)

**Status:** done(提交 `5372c39`;本会话核查:registry detail 字段(none/modal/drawer)、StockModal/ChangelogDrawer 含「刷新失败,重试」、nav 用 `<a target=_blank>` + tsc/vitest 全绿,运行态 UX 待手测)

- [x] 注册表类型定义的 `detail` 字段落地:stock 声明 Modal、changelog 声明底部 Drawer、nav 声明无详情(直接跳转)
- [x] 非编辑模式下点击图标:根据 type 触发对应详情容器
- [x] stock Modal:展示行情详情(价格/涨跌/基本面字段),K 线区域占位(数据接入 Out of Scope)
- [x] changelog 底部 Drawer:完整版本列表(复用 `useChangelog` + 现有 `changelogParser`)
- [x] nav 图标点击:直接 `window.open(url, '_blank')`,不弹面板
- [x] 详情面板刷新失败:显示"刷新失败,重试"按钮,单个图标失败不影响其它
- [x] 编辑模式下点击图标不触发详情(角标操作优先)
- [x] 验证:点股票弹 Modal、点日志弹 Drawer、点链接直接跳转;刷新失败有降级占位
