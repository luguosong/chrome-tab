# 02 — 调研:dnd-kit 弹层内拖出到页面网格的方案

Type: research
Status: resolved

## Question

分组打开态是一个居中弹层(暗化背景),子图标要能从中**拖出**、落到背后的页面网格(移出分组),且弹层内子图标可互相排序。用 @dnd-kit(项目已用,见 icon-grid issues 06/07 与 ADR-0003)如何实现?

- 同一 DndContext 覆盖弹层 + 页面(两个 SortableContext)是否可行?弹层用 portal 渲染时碰撞检测/坐标是否有坑?
- 官方 multiple containers 示例、DragOverlay 与动态显隐容器的组合;nested DndContext 的已知 issue。
- 拖拽穿越弹层边界(容器切换)时 onDragOver/onDragEnd 的时序;拖出后弹层的显隐策略。
- 目标:给出推荐实现方案(单一 context vs 嵌套)+ 已知坑清单,供 spec 与实现票引用。

结论写到仓库 `research/dnd-overlay-drag-out` 分支(throwaway),完成后本票正文回填指针。

## Answer

**结论文件**:`research/dnd-overlay-drag-out` 分支 @ `d0a6ea1`,路径 `.scratch/liquid-glass-and-groups/research/02-dnd-overlay-drag-out.md`(202 行)。读取:`git show research/dnd-overlay-drag-out:.scratch/liquid-glass-and-groups/research/02-dnd-overlay-drag-out.md`。

要点(详证见结论文件):

1. **单一根 DndContext,不嵌套**——维护者原话:嵌套 context 事件不互通(discussion #766);局部感知用 `useDndMonitor`。
2. **portal 无坐标坑**:core 全走 `getBoundingClientRect()` 视口坐标;唯一硬约束是 portal 调用点必须在根 DndContext 的 React 子树内,否则 `useSortable` 静默失效(issue #58)。
3. **跨容器照官方 MultipleContainers 三段式**(onDragStart 快照 → onDragOver 判容器变化乐观搬移 → onDragEnd 收尾/onDragCancel 回滚)——**本项目跨页拖拽已是同套机制,分组弹层只是"第 N+1 个容器",零新范式**。
4. **最大坑在 backdrop 不在 dnd-kit**:盖满视口的暗化层若 `pointer-events:auto`,拖出弹层后 over 永远落不到页面网格——backdrop 必须 `pointer-events:none`,内容区单独恢复交互。
5. 弹层关闭时机放 onDragEnd(确认落点是页面网格再关);拖拽中途绝不卸载弹层/被拖项;ESC 走 onDragCancel 回滚、弹层保持开。
6. 其余坑(带 issue 编号):onDragOver 缺守卫致渲染循环(#735/#1421/#1465)、跨容器搬移瞬间 over 抖动需 `lastOverId` 稳定化、空分组需保留容器 droppable、模态拖拽 a11y 边角(#1870)。
7. 版本背景:classic 6.x(core 6.3.1,2024-12)迭代放缓,官方重心在 `@dnd-kit/react`;本项目锁 6.x,调研基于 legacy 文档 + master 源码。

