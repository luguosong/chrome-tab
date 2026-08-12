# 采用 @dnd-kit 作为拖拽库

采用 `@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/utilities` 实现图标的同页排序与跨页拖拽。

这是用"跨容器支持 + 开发效率"换取"极致体积"的刻意取舍。备选方案被否决的理由:

- **react-dnd**:最后发布 2022 年初,已被业界标记为不推荐用于新项目;跨容器需手写大量接线。
- **react-grid-layout**:官方不支持跨容器拖拽(单网格设计);一个支持跨网格的社区 fork 会把核心需求押在非主线上。
- **Pragmatic drag-and-drop (Atlassian)**:体积更小、性能更好,但无 `useSortable` 抽象,多容器多尺寸排序需自行从原语组合,开发成本明显更高。

@dnd-kit 的契合点:跨容器拖拽是其标杆场景(每页一个 `SortableContext`,`onDragOver` 做跨页移动);`PointerSensor` 单传感器覆盖鼠标+触摸(长按 250ms 激活,避免与走马灯滑动冲突);React 18 一等支持;~10-15 kB gzip。

关键实现约束(dnd-kit 已知坑):
- 走马灯中**未挂载的页面没有 droppable**。所有页面须常驻挂载,用 `visibility:hidden` 隐藏非活动页(不可用 `display:none`,会返回零 rect 破坏碰撞)。
- 多尺寸(1×1/2×2/3×2)网格用 `closestCorners` 碰撞算法 + 自定义 fallback 链(`pointerWithin → rectIntersection → closestCorners`),而非默认 `rectIntersection`(在可滚动容器中已知异常)。
