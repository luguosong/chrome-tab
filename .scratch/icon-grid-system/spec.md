Status: ready-for-agent

# 图标网格系统

## Problem Statement

当前 chrome-tab 新标签页用三个写死的磁贴组件(`NavTileGroup` / `StockTile` / `ChangelogTile`)作为走马灯的三个固定 slide 承载快速导航、更新日志、自选行情。用户无法自由编排元素:不能拖拽排序、不能切换图标大小、不能把一个元素移到另一页、不能增删页面、不能添加新类型的图标。组容器("快速导航"整组)是编排的最小单位,而非单个元素,自由度受限,且每新增一种图标都要改 `DashboardPage`、改持久化、改 UI——没有扩展点。

## Solution

将一切元素升级为**图标(Icon)**——元素级的最小可操作单位(每条网站链接、每只自选股、整条更新日志流各为一个图标)。图标分布在用户可管理的**页面(Page)**之间(走马灯的每一屏),页面是**固定画布**(不产生纵向滚动条,滚轮用于翻页)。图标有大/中/小三档尺寸(同时决定网格跨度与信息密度),可同页拖拽排序、可跨页拖拽移动。引入**图标类型注册表**作为扩展点:新增一类图标只需注册一个类型定义,不改 schema、不改核心。

编排入口与新增入口分离:右键进入**编辑模式**(删图标、改尺寸、拖拽、管理页面);右上角"+"按钮打开**新增抽屉**(选类型填表单即填即加到当前页)。点击图标看详情,详情容器形态由类型自定。

## User Stories

### 查看与切换

1. 作为用户,我想开屏看到熟悉的快速导航、日志、行情三页,使升级后体验无感
2. 作为用户,我想用滚轮在页面之间切换,使我不必精确点击翻页按钮
3. 作为用户,我想用键盘左右键切换页面,使我能在无鼠标时操作
4. 作为用户,我想通过常驻的页签条看到当前在第几页及各页名称,使我知道上下文
5. 作为用户,我想点击页签条上的页名切换到该页,使切换快速直接
6. 作为用户,我想页面内容始终在视口内完整呈现(不出现纵向滚动条),使布局稳定不跳动
7. 作为用户,我想在不同视口尺寸(桌面/平板)下都能正常查看图标网格,使布局响应式自适应

### 图标查看

8. 作为用户,我想看到小图标只显示 favicon,使页面简洁清爽
9. 作为用户,我想看到中图标显示 favicon + 名称,使我能辨认图标身份
10. 作为用户,我想看到大图标显示 favicon + 名称 + 实时摘要(股票价格涨跌、日志最新版本条目),使我不必点开就能获取关键信息
11. 作为用户,我想点击股票图标弹出 Modal 看完整详情(K 线/基本面),使我能深入研究
12. 作为用户,我想点击更新日志图标弹出底部 Drawer 看完整版本列表,使我能浏览历史更新
13. 作为用户,我想点击网站链接图标直接在新标签页打开目标 URL,使我能快速跳转
14. 作为用户,我想在某个图标摘要刷新失败时看到该图标显示降级占位(灰色"--"),使单个故障不影响其它图标
15. 作为用户,我想在详情面板刷新失败时看到"刷新失败,重试"提示,使我能主动重试而非干等

### 新增图标

16. 作为用户,我想点击右上角"+"按钮打开新增抽屉,使我能集中选择要添加的图标类型
17. 作为用户,我想在新增抽屉里看到所有可用类型按"基础/扩展"分区展示,使我能按用途浏览
18. 作为用户,我想在新增抽屉每张类型卡片内直接填写配置(链接=name+url,股票=symbol+name)并提交即加到当前页,使添加流程一步到位不走多步向导
19. 作为用户,我想提交后抽屉保持打开,使我能连续添加多个图标
20. 作为用户,我想已存在的单例类型(更新日志)在新增抽屉中置灰不可再选,使我不误加重复实例
21. 作为用户,我想在当前页已满时新增被拒绝并提示"此页已满,请新建页面或移至其它页",使我理解为何加不上
22. 作为用户,我想提交链接时自动补全 https:// 前缀,使我不必每次手动输入协议

### 编辑模式

23. 作为用户,我想右键进入编辑模式,使我能开始编排图标和页面
24. 作为用户,我想再次右键退出编辑模式,使退出路径与进入一致
25. 作为用户,我想进入编辑模式时顶部出现提示条"编辑模式 · 右键退出",使我明确当前处于编排态
26. 作为用户,我想在编辑模式下图标轻微抖动(jiggle)以提示可操作,与现有导航磁贴交互一致
27. 作为用户,我想在编辑模式下点击图标右上角的"×"删除该图标,延续现有交互惯性
28. 作为用户,我想在编辑模式下点击图标角标的尺寸菜单切换大/中/小三档,使我能按需调整信息密度
29. 作为用户,我想非编辑模式下点击图标正常触发其默认行为(看详情/跳转),使查看与编排互不干扰

### 拖拽

30. 作为用户,我想在编辑模式下拖拽图标在同页内重新排序,使布局由我掌控
31. 作为用户,我想在编辑模式下把图标拖到屏幕左右边缘停留约 400ms 自动翻到相邻页,使我能跨页移动图标而无需先放下
32. 作为用户,我想拖拽跨页后图标跟随光标进入新页的网格,使移动过程连续可视
33. 作为用户,我想长按约 250ms 才触发拖拽(而非轻触),使走马灯的滑动翻页不被拖拽误触发
34. 作为用户,我想拖入的目标页已满时被拒绝并提示,使容量约束一致生效
35. 作为用户,我想拖拽时有视觉反馈(占位、位移),使操作可感知

### 页面管理

36. 作为用户,我想在常驻页签条上拖拽页签重排页面顺序,使页面顺序由我掌控
37. 作为用户,我想在编辑模式下新建页面,使我能按主题组织图标
38. 作为用户,我想在编辑模式下给页面重命名,使页名反映内容
39. 作为用户,我想在编辑模式下删除空页面,使我能精简结构
40. 作为用户,我想删除非空页面前被要求确认或被阻止,使我不误删有内容的页面
41. 作为用户,我想页数无上限(页签条超出宽度时横向滚动),使我不受人为限制
42. 作为用户,我想编辑模式下每页角标显示剩余格数,使我能预判是否还能加图标

### 数据迁移

43. 作为现有用户,我想升级后我的 12 条导航链接、13 只自选股、更新日志流都保留并自动归到三个默认页(快速导航/日志更新/行情),使我不必重新配置
44. 作为现有用户,我想升级后链接默认小图标、股票默认中图标、日志默认大图标,使开屏信息密度合理

## Implementation Decisions

### 领域模型(见 `CONTEXT.md`)

- **Icon**:元素级最小单位。归属某 Page,有 `type` + `size` + `sortOrder` + 类型专属配置(JSON)。
- **Page**:走马灯一屏,固定画布,一等公民(增/改名/排序/删)。`Page { id, userId, name, sortOrder }`。
- **IconType 注册表条目**:声明 `{ kind: base|extension, singleton: boolean, sizes: Size[], defaultSize, refresh config, summarize renderer, detail container+renderer, editor form }`。
- **Size**:三档,在 6 列网格中 `small=1×1`、`medium=2×2`、`large=3×2` 个格子。
- **页面容量**:`列数(6) × 行数(视口高度决定,典型 4)`。占用之和达容量即拒绝新增/拖入。
- 术语统一遵循 `CONTEXT.md`(`Icon` / `Page` / `Size` / `Cell` / `Page Capacity` / `Icon Type` / `Base|Extension Type` / `Singleton Type` / `Edit Mode` / `Add Drawer`)。

### 持久化(见 ADR-0001)

新 schema(Flyway 新增迁移):

| 表 | 关键列 |
|---|---|
| `pages` (新) | `id, user_id, name, sort_order, created_at` |
| `icons` (新) | `id, user_id, page_id, type, size, sort_order, data TEXT, created_at` |
| ~~`nav_links`~~ | 删除,数据迁入 `icons(type='nav', data={name,url})` |
| ~~`stock_watches`~~ | 删除,数据迁入 `icons(type='stock', data={symbol,name})` |
| `users` / `settings` | 保留不变 |

- `icons.data` 用 **`TEXT` + JPA `AttributeConverter`** 存 JSON,**不用 MySQL 原生 `JSON` 类型**(换取 MySQL/H2 方言一致,见测试决策)。
- 每个 type 的 `data` 结构由该类型自定(nav=`{name,url}`、stock=`{symbol,name}`、changelog 无 data)。类型注册表声明其 `data` 的解析与默认值。
- 现有 `ConfigController` 聚合响应从 `{navLinks, stockWatches, setting}` 改为 `{pages, icons, setting}`,`pages` 带 `id/name/sortOrder`,`icons` 带 `id/pageId/type/size/sortOrder/data`。

### 迁移(见 ADR-0002,默认页 = 3 页)

迁移脚本(一次性,在新 schema 建表后执行):

1. 为现有 admin 用户创建 3 个默认 Page:P1="快速导航"(sortOrder=0)、P2="日志更新"(sortOrder=1)、P3="行情"(sortOrder=2)。
2. 现有 `nav_links` 12 条 → `icons(page_id=P1, type='nav', size='small', sort_order=原序, data={name,url})`。
3. 现有 `stock_watches` 13 条 → `icons(page_id=P3, type='stock', size='medium', sort_order=原序, data={symbol,name})`。
4. 新增 1 条 `icons(page_id=P2, type='changelog', size='large', sort_order=0, data=null)`(单例,迁移时确保唯一)。
5. 校验容量:12 个 small(12 格)≤ P1 容量;1 个 large(6 格)≤ P2 容量;13 个 medium(52 格)→ **超过单页容量**,P3 行情页需要拆分或允许中图标在多行内排布——以实际视口行数为准,迁移脚本按"装满一页再开 P3.5"策略,把溢出的股票放到追加的"行情(续)"页。
6. 迁移完成后 `DROP TABLE nav_links, stock_watches`。

### 后端 API 契约

覆盖式重构(路径前缀 `/api`):

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/config` | 聚合 `{pages, icons, setting}`(替换旧聚合) |
| POST | `/pages` | 新建页,body=`{name}` |
| PUT | `/pages/{id}` | 改名,body=`{name}` |
| DELETE | `/pages/{id}` | 删页(非空页返回 409,或级联删图标——见 Out of Scope 决策) |
| PATCH | `/pages/reorder` | 批量重排,body=`[{id, sortOrder}]` |
| POST | `/icons` | 新建图标,body=`{pageId, type, size, data}`;校验单例 + 容量 |
| PATCH | `/icons/{id}` | 改 size 或 data,body 部分字段 |
| DELETE | `/icons/{id}` | 删图标 |
| PATCH | `/icons/move` | 移动/重排,body=`{id, toPageId, toIndex}`(跨页与同页统一) |
| GET/PUT | `/settings` | 保留不变 |

- 容量校验在 POST `/icons` 和 PATCH `/icons/move` 服务端执行:目标页 `sum(sizeCell[size]) + 新增格子 > capacity` → 返回 409,错误体指明剩余格数。
- 单例校验:POST `/icons` 时若 `type` 的注册表声明 `singleton` 且该 user 已有该 type 实例 → 返回 409。
- 现有 `/nav-links`、`/stock-watches` 端点**删除**。

### 前端架构

- **`IconTypeRegistry`**(新):`register(typeId, definition)`。3 个内置定义(nav/stock/changelog)。类型定义含摘要渲染、详情容器(stock=Modal / changelog=底部 Drawer / nav=无)、配置表单、刷新配置、单例标志、支持尺寸。
- **`IconGrid`**(新,替换 `NavTileGroup`/`StockTile`/`ChangelogTile` 三件套):`@dnd-kit` 的 `DndContext > SortableContext(每页) > useSortable(每图标)`。所有页常驻挂载,用 `visibility:hidden` 隐藏非活动页。
- **`Carousel`**(改):承载多页,滚轮翻页,键盘 ←→,左右边缘 `useDroppable` 实现拖拽自动翻页(~400ms)。
- **`PageTabs`**(新,常驻):切换 + 拖拽排序页;增/改名/删进编辑模式面板。
- **`AddDrawer`**(新):右上角"+"唤起,类型卡片网格,每张内嵌配置表单,提交即加到当前页末尾,抽屉常开,单例类型置灰。
- **`EditModeContext`**(改):右键切换;图标角标(删除 × + 尺寸菜单);页面增删改面板;页角标显示剩余格数。
- **`DashboardPage`**(改):从写死的 3 slide 改为从 `useConfig().pages` 动态渲染;顶部"+"按钮。
- **碰撞算法**:`pointerWithin → rectIntersection → closestCorners` 自定义 fallback 链(应对多尺寸)。
- **传感器**:`PointerSensor`,`activationConstraint: { delay: 250, tolerance: 5 }`(长按激活,避免与走马灯滑动冲突)。

### 刷新策略(见 Q3=B)

类型注册表声明各自刷新配置,沿用现有 hook 模式:
- stock:60s 轮询(交易时段;收盘后停),失败降级灰色"--"。`useQuotes` 复用。
- changelog:1h staleTime,`useChangelog` 复用。
- nav:无刷新。

### 技术栈增量

- `@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/utilities`(~10-15 kB gzip,React 18 一等支持,见 ADR-0003)。

## Testing Decisions

**测试哲学**:只测外部行为,不测实现细节。组件内部的 dnd 事件编排、抽屉开关、右键菜单不测(手动验证);可测的纯逻辑从组件抽成纯函数,沿用 `frontend/src/lib/*.test.ts` 的 Vitest 先例。

### 接缝 1 — 后端 REST 契约(`@SpringBootTest`)

- **范围**:Page/Icon 的 CRUD、聚合接口、容量校验(满页拒绝)、单例约束、迁移正确性。
- **形式**:`@SpringBootTest` + `@AutoConfigureMockMvc` + `@ActiveProfiles("test")` + `@Transactional`(每测自动回滚),打 HTTP 验证状态码 + JSON 断言。
- **数据隔离(关键)**:
  - 新增 `com.h2database:h2`(test scope)依赖。
  - 新增 `src/test/resources/application-test.yml`:datasource 指向 `jdbc:h2:mem:newtab;MODE=MySQL`。
  - **关闭 Flyway**(`spring.flyway.enabled=false`),因为现有迁移脚本是 MySQL 方言,不兼容 H2。
  - `ddl-auto=create-drop`,JPA 从实体生成 H2 schema。这要求新实体不依赖 MySQL 专有特性(`icons.data` 用 `TEXT` + `AttributeConverter` 而非 `JSON` 类型,正是为此)。
  - 开发库 `localhost:19002/newtab` 绝不接入测试。
  - `@Transactional` 保证每测结束回滚,即使误连也不持久化。
- **迁移测试**:单独一个 `@SpringBootTest`(非 `@Transactional`,带 `@Sql` 或直接调用迁移代码)在干净 H2 上执行迁移逻辑,断言 3 个默认页、图标数量与归属正确。此测试不连任何外部库。
- **先例**:本项目后端目前无测试目录,这是引入的第一个后端测试;形式对齐 Spring Boot 官方 `@SpringBootTest + MockMvc` 范式。

### 接缝 2 — 前端纯逻辑函数(Vitest)

- **范围**:把可测逻辑从组件抽成纯函数,对齐 `frontend/src/lib/changelogParser.test.ts` / `quoteParser.test.ts` 先例。
  - `capacity.ts`:`cellsUsed(icons)` / `capacityFor(cols, rows)` / `canFit(page, newIcon)`。
  - `iconReducer.ts`:`moveIcon(state, {id, toPageId, toIndex})`(同页排序 + 跨页移动,纯 reducer,供 `onDragOver`/`onDragEnd` 调用)。
  - `registry.ts` 查询:`canAdd(type, existing)`(单例判断)、`sizesFor(type)`。
- **形式**:Vitest,纯函数输入输出断言,无 DOM。
- **先例**:`frontend/src/lib/*.test.ts`(已存在)。

### 不测的部分

- 拖拽 UX、抽屉开关、右键菜单、视觉反馈——纯 UI 编排,手动验证。

## Out of Scope

- **页面删除的级联策略**:非空页删除是"阻止(409)"还是"级联删图标",本 spec 暂定**阻止非空页删除**(更安全),最终交互可后续微调。
- **图标配置的编辑**:本 spec 只覆盖"新增"与"删除/改尺寸";编辑现有图标的 `data`(如改链接 url、换股票代码)不在范围,后续可加。
- **自定义图标尺寸**(用户拖拽手柄任意调大小):只支持注册的三档(small/medium/large),不支持自由像素尺寸。
- **多用户**:仍单 admin,所有数据属于该 admin。
- **图标主题/样式定制**:不改主题系统(沿用现有 `setting.theme`)。
- **E2E 测试(Playwright 等)**:不引入,拖拽 UX 靠手动验证。
- **股票详情里的 K 线高级形态**:收盘价折线已接入(东财 push2his JSONP,纯前端,见 ADR-0004 附注);成交量副图/均线/周期切换/十字光标等高级形态仍不在范围。
- **页面模板/共享**:不支持页面的导入导出或模板化。

## Further Notes

- 相关 ADR:`0001-polymorphic-icon-table-and-type-registry`、`0002-page-as-fixed-canvas-with-capacity`、`0003-dnd-kit-for-drag-and-drop`。
- 术语以 `CONTEXT.md` 为准。
- 建议实现顺序(供后续 ticket 拆分):① 后端 schema + 迁移 + REST + 后端测试 → ② 前端类型注册表 + 数据模型 → ③ `IconGrid` + `Carousel` 多页渲染(无拖拽,先静态) → ④ `@dnd-kit` 同页排序 → ⑤ 跨页拖拽 + 边缘翻页 → ⑥ `PageTabs` + 页面管理 → ⑦ `AddDrawer` → ⑧ 详情面板(Modal/Drawer) → ⑨ 容量校验 UI + 剩余格数角标。每步可独立验证。
