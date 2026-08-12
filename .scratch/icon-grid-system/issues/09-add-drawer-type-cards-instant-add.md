# 09 — 新增抽屉:右上角"+"→ 类型卡片即填即加

**What to build:** 实现新增图标的核心入口。`DashboardPage` 右上角添加"+"按钮,点击打开侧抽屉(Add Drawer)。抽屉内按"基础类型/扩展类型"分区展示所有可用图标类型,每类一张卡片,卡片内直接嵌入该类型的配置表单(nav=name+url,stock=symbol+name,changelog 无表单)。填完提交即调 `POST /api/icons` 落到当前页末尾,抽屉保持打开以支持连续添加。单例类型(更新日志)若已存在则置灰不可选。当前页已满时新增被拒(409),抽屉提示"此页已满"。

遵循 `CONTEXT.md`(新增抽屉、单例类型、基础/扩展类型)。

**Blocked by:** 04 — 后端 Icon 写 API(04)(新增需要 POST 端点与容量/单例校验)

**Status:** done

- [x] `DashboardPage` 右上角"+"按钮(与现有 ThemeToggle/登出 同区)
- [x] `AddDrawer` 侧抽屉组件(从右侧滑入,有遮罩与关闭按钮)
- [x] 类型卡片网格:按基础/扩展分区(从注册表读取),每卡内嵌该类型 `editor` 声明的配置表单
- [x] 单例类型已存在时置灰并标注"已添加"
- [x] 提交调 `POST /api/icons`(pageId=当前页末尾,type,data,size=该类型 defaultSize),react-query 失效后即时出现
- [x] 提交成功后抽屉保持打开,清空表单,可连续添加
- [x] 链接 url 自动补 https:// 前缀(沿用现有 `normalizeUrl` 逻辑)
- [x] 当前页已满(409)时抽屉提示"此页已满,请新建页面或移至其它页"
- [ ] 验证:加链接/股票/日志图标后即时出现在当前页末尾;连续添加多个;单例不可重复;页满提示
