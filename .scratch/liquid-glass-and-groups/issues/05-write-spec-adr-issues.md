# 05 — 落笔:spec + ADR + CONTEXT.md 术语 + issue 拆分

Type: task
Status: resolved
Blocked by: 04

## Question

(无待决——全部决策已在 map 与 04 收口)把通过的草案落成仓库工件:

- `.scratch/liquid-glass-and-groups/spec.md`(按 04 通过稿);
- `docs/adr/0011-*`:分组 = 图标行(`type='group'`)+ 可空 `parent_id`,复用注册表/拖拽/CRUD;容量语义(子图标不计页面容量,组占 1 格);Liquid Glass 视觉体系是否另立 ADR 按 04 结论;
- `CONTEXT.md`:新增「分组 (Group)」术语,修订「图标」「页面容量」相关表述;
- `.scratch/liquid-glass-and-groups/issues/`:实现票拆分,编号从 06 续(后端 schema/API → 前端分组交互 → Liquid Glass 组件层 → 外围 chrome → 迁移/收尾),每票可独立验证。

完成即抵达本图目的地。

## Answer

**全部工件已落仓库(2026-08-19),经一轮三视角对抗校验(决策覆盖 / 事实准确 / 内部一致)修订后定稿:**

- `.scratch/liquid-glass-and-groups/spec.md`(`Status: ready-for-agent`;结构对齐 icon-grid-system spec:Problem / Solution / User Stories 16 条 / Implementation Decisions / Testing Decisions / Out of Scope / Further Notes)
- `docs/adr/0011-groups-as-icon-rows-with-parent-id.md`(分组模型:图标行 + `parent_id` RESTRICT + 容量语义 + merge/dissolve/move + 备份 v2;含三条已否决备选)
- `docs/adr/0012-liquid-glass-three-tier-material-system.md`(三档材质 + 方向 C 裁决 + glass-on-glass 让位记录 + 不引库)
- `CONTEXT.md`:新增「分组 (Group)」;修订「图标」「页面容量」「编辑模式」
- 实现票 7 张 `issues/06–12`(06 数据 → 07/08 交互;09 视觉基建并行 → 10/11/12 换肤,12 兼收尾回归),全部 `Type: task` / `Status: ready-for-agent`

**落笔期消化的新决策**(均为 04 结论的机制化或校验发现的缺口填补,非新方向):

1. merge 的 `memberIds` 语义定为「首位 = 被拖图标 A、末位 = 悬停目标 B」——「组继承 B 的 sort_order」需要后端识别 B。
2. **空组不存活**:任何路径(move 移出、DELETE 子图标)使组变空都事务内自动删组行;导入校验拒绝空组;直接 DELETE 含成员组行 409「请先解散」。
3. **备份 wire 图标行必须增 `id`**(照 pages 客户端键先例)——现 wire 图标无 id,全删重建后 `parentId` 无键可指,替换与合并导入都要 iconIdMap 重映射;镜像 LWW/和解机制零改动,wire 格式扩展。
4. `PUT /api/config` 全删改两段有序(先子行后顶层行)——RESTRICT 逐行即时检查,单条 `deleteAllInBatch` 先父后子即触发。
5. 备份导入放宽为**双接受 v1/v2**(现 `parseBackupPayload` 严格不等即拒,直接 bump 会拒掉 v1 旧备份)。
6. `Clock.tsx` 现为**未挂载**遗留组件(顶部常驻仅搜索框)——票 11 含「时钟重新挂载」而非仅换肤。
7. L0 页板现值已与定稿一致(定标不改动);材质「亮」分支当前永久深色下不生效,token 落全为将来主题化留量。

**目的地抵达,map 关闭。** 研究/原型资产仍在 throwaway 分支(`research/liquid-glass` @ `bc2b909`、`research/dnd-overlay-drag-out` @ `d0a6ea1`、`prototype/liquid-glass` @ `3f10ddf`),票与 spec 内有指针,可按需保留或清理。
