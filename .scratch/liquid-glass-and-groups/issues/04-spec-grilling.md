# 04 — Grilling:spec 定稿评审

Type: grilling
Status: resolved
Blocked by: 01, 02, 03

## Question

把「Liquid Glass 全 UI 重塑 + 导航分组」的全部已定决策(map · Notes)、原型选型(03)、两份研究结论(01/02)合成 spec 草案,与用户逐节过一遍并收口:

- spec 草案结构对齐 icon-grid-system spec(Problem / Solution / User Stories / Implementation Decisions / Testing / Out of Scope)。
- 逐节确认:分组领域模型与容量语义表述、ADR 边界(0011 分组模型;Liquid Glass 视觉体系是否独立成 ADR)、外围 chrome 改版的切票边界、迁移与 schemaVersion、测试面。
- 用户的异议与新增诉求在此轮消化完,不留到落笔。

需要用户实时参与(grilling),不得代答。

## Answer

**三轮 grilling 收口(2026-08-19,用户逐项裁决)。** 以下为 spec 落笔(05)的全部依据:

### ADR 边界

拆两份:**0011 分组模型**(数据模型决策)、**0012 Liquid Glass 视觉体系**(三档材质 + 方向 C 裁决 + glass-on-glass 让位记录)。

### 分组交互语义

- 组内排序/拖出**仅编辑模式**(与页面网格一致,「只叠加不改写」);打开态在编辑模式下子图标同样有 × 可删。
- 加入既有组 = 与建组**同一悬停手势**(编辑模式拖图标悬停到组上,反馈同为放大);组拖到组/图标上**不触发合并反馈**,落下按普通排序。
- 合并落位:组**继承被悬停目标 B 的 `sort_order`**,A 从序列移除,空位由后续图标流式自然补上(iOS 文件夹同款)。
- 加入落位:组内**序列末尾**。

### 组内多页(推翻建图期决策「组上限 9 个」)

- 组内成员 = **线性 `sort_order` 序列,无上限**;弹层按 **9 个/页自动流式分页**(第 k 页 = 序列 `[9k, 9k+9)`)——展示切片,**不引入「组内页」实体**(无空页、无页管理)。
- 弹层打开时**滚轮翻组内页**(不透传背景走马灯);≤9 个成员时滚轮事件吃掉即可。
- 组图标 3×3 迷你预览 = **前 9 个**(第一页);弹层带**页点指示器**。
- 跨组内页重排本期**不支持**(Out of Scope;自动流式分页下顺序本就跨页流动,长尾需求)。
- 「满组拒绝」概念取消;页内组数无显式上限(64 格容量自然限制)。

### API 契约

- 专用复合端点:`POST /icons/merge`(body: `pageId + memberIds[]` → 返回组;事务内建组 + 挂成员 + nav-only/类型校验)、`POST /icons/{id}/dissolve`(解散,成员按保留 size 洒回原组位置,**容量不足返回 409**,前端提示先移出部分图标)。
- 移出与组内排序**复用现有** `PATCH /icons/move` 扩展 `{id, toPageId, toIndex, parentId}`(parent → null 即移出);容量校验:移出时子图标按保留 size 计入目标页。

### 迁移与 schemaVersion

- Flyway **V7**:`icons` 加 `parent_id BIGINT NULL` + 自引用 FK,`ON DELETE RESTRICT`(组行删除前必须先解散,DB 层防「误删组连带吞子图标」,偏离项目惯用 CASCADE 是有意为之)。
- `BACKUP_SCHEMA_VERSION` **1 → 2**;旧备份(parent_id 缺失)导入按 null 兼容,**不写转换器**。
- 纯加列,**无数据迁移脚本**。

### 实现切票(7 张,编号续 06)

| 票 | 内容 | 轴 |
|---|---|---|
| 06 | 后端:V7 + merge/dissolve/move 扩展 + 契约测试(容量/nav-only/解散 409)+ 前端 schemaVersion→2 与 mirror 兼容 | 数据 |
| 07 | 前端分组网格交互:合并手势、组图标渲染(3×3)、加入组、解散洒回 | 交互 |
| 08 | 分组弹层:打开/改名/组内排序/拖出/滚轮翻组内页(研究票 02 方案:单 context、backdrop pointer-events:none) | 交互 |
| 09 | Liquid Glass 基建:材质 token css(L0/L1/L2 参数表)+ LensBox(ResizeObserver 重建 SDF map、@supports 回落 L1) | 视觉 |
| 10 | 图标层换肤:nav squircle soft 档、widget iOS 小组件排版、组样式 | 视觉 |
| 11 | 外围 chrome 换肤:搜索框/页签条/胶囊/箭头 L2、时钟裸排 | 视觉 |
| 12 | 详情面板换肤 + 收尾:StockModal/WeatherModal/AddDrawer/SettingsDrawer/BackupRestore L1 皮肤,跨票回归 | 视觉 |

依赖:06→07→08;09 可与 06–08 并行;10/11/12 依赖 09。

### spec 表述细则

- 组内子图标 `sort_order` 每组独立 0..n;页面序列只看 `parent_id IS NULL` 的行。
- 组名显示在组图标下方(与 nav 名称同位),默认「新建分组」,改名清空回落默认。
- 组图标无尺寸菜单(固定 1×1)、无 ✎(改名走打开态点名称)。
- L2 加一行 `@supports` 回落 L1(廉价保险,目标虽是 Chrome)。
- 手势判定参数(dwell/悬停半径/放大倍率、长按阈值分配):spec 只定行为与反馈形态,数值留实现票。

### 测试面

- 后端(@SpringBootTest + H2):merge/dissolve/move 状态转移、容量(组占 1 格子不计、解散 409)、nav-only 约束。
- 前端(Vitest 纯函数):`groupReducer`(merge/dissolve/move-out/分页切片)+ `capacity` 扩展。
- 视觉与手势手动验证。
