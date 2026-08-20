# 08 — 前端:分组弹层(打开/改名/翻页/组内排序/拖出)

Type: task
Status: ready-for-agent
Blocked by: 07 — 分组网格交互(组图标渲染与手势基建)

**What to build:** 新组件 `GroupOverlay`。点组图标打开:暗化背景 + 居中玻璃面板(09 落地前用现有 `.glass-panel`),点外部关闭;点子图标 = 触发其默认行为(打开网站)后关闭;点面板内组名 = 行内改名(**不限编辑模式**,清空回落「新建分组」,`PATCH data`)。组内成员线性序列按 **9 个/页自动流式分页**(第 k 页 = `[9k, 9k+9)`,展示切片、无「组内页」实体);弹层滚轮翻组内页(**不透传**背景走马灯;≤9 个成员吃掉滚轮事件);页点指示器。拖拽(仅编辑模式):**单一根 `DndContext` 的 React 子树内 portal** 渲染(硬约束,否则 `useSortable` 静默失效);暗化 backdrop 常态 `pointer-events: none`、内容区单独恢复交互(否则拖出后 over 永远落不到页面网格);弹层 = 拖拽体系里又一个 `SortableContext`(id=组 id),跨容器搬移照官方 MultipleContainers 三段式:onDragStart 快照 → onDragOver 判容器变化乐观搬移(**判空 / 同容器早退守卫**,防渲染循环)→ onDragEnd 收尾持久化;**弹层关闭判定放 onDragEnd**(确认落点是页面网格才关),拖拽中途绝不卸载弹层/被拖项;ESC/取消走 onDragCancel 回滚、弹层保持开。编辑模式子图标同样有 ×(删除,直连 `DELETE /api/icons/{id}`)。完整 gotcha 清单与官方示例源码指针见 `research/dnd-overlay-drag-out` 分支(@ `d0a6ea1`,9 条坑逐一核对)。

遵循 `CONTEXT.md`(分组)与 ADR-0003、ADR-0011。

**工具:** 实现时使用 ui-ux-pro-max 插件——动工前 Skill 调用 `ui-ux-pro-max:ui-ux-pro-max`(UI/UX 设计智能);涉及 Tailwind 样式细节可配 `ui-ux-pro-max:ui-styling`。

- [ ] 打开/关闭(点外部)、点子图标默认行为后关闭
- [ ] 点名称改名(任意模式;清空回落默认)
- [ ] 9/页流式分页 + 滚轮翻页(≤9 吃掉滚轮,不透传走马灯)+ 页点指示器
- [ ] portal 在根 DndContext 子树内;backdrop 常态 `pointer-events:none`、内容区恢复交互
- [ ] 编辑模式:组内排序(SortableContext)+ 拖出到页面网格(move parentId=null,按保留 size 落位计容量)+ 子图标 ×
- [ ] onDragOver 判空/同容器守卫;onDragEnd 关弹层;onDragCancel 回滚且弹层保持开
- [ ] Vitest:组内分页切片纯函数(落 `groupReducer.ts`,07 已建;`[9k, 9k+9)` 边界:恰好 9 / 10 / 18 / 19 个)
- [ ] 验证:手动走查打开 / 改名 / 翻页 / 排序 / 拖出 / ESC 回滚 — **待手动验证**
