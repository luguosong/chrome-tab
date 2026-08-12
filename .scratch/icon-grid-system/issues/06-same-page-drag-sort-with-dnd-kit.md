# 06 — 同页拖拽排序(@dnd-kit 接入)

**What to build:** 引入 `@dnd-kit` 实现编辑模式下的同页拖拽排序。建立拖拽基础设施:根 `DndContext` 包裹整个走马灯,每个页面一个 `SortableContext`,每个图标用 `useSortable`。配置 `PointerSensor`(长按 250ms 激活 + 5px 容差,避免与走马灯滑动翻页冲突),多尺寸碰撞用 `closestCorners` + 自定义 fallback 链(`pointerWithin → rectIntersection → closestCorners`)。所有页面常驻挂载(用 `visibility:hidden` 隐藏非活动页,不可用 `display:none`,否则 droppable 无 rect)。`onDragEnd` 同页重排调 `PATCH /api/icons/move` 持久化新顺序。

遵循 ADR-0003(@dnd-kit)。

**Blocked by:** 05 — 编辑模式(05)(拖拽在编辑模式下进行)

**Status:** done(代码完成 + tsc/测试/构建通过;拖拽 UX 待手动验证)

> 2026-08-11 验证补充:`PATCH /api/icons/move` 同页重排路径已端到端验证(首项移到 index 3 → GET 重读确认落库 → 还原,均 PASS)。拖拽 PointerSensor(250ms 延迟激活)的运行态 UX 未手测——IAB 浏览器自动化受阻(webview 不可用,且 API 无右键原语进入编辑模式、仅有快路径 cua.drag 难以满足延迟激活)。

- [x] 安装 `@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/utilities`
- [x] 根 `DndContext`(sensors=`PointerSensor` delay 250ms tolerance 5,自定义 collisionDetection,`onDragStart`/`onDragEnd`/`onDragCancel`)
- [x] 每页 `SortableContext`(items=该页 iconIds,strategy=`rectSortingStrategy`)
- [x] 每图标 `useSortable`(`data` 带 pageId/size 供 handler 读取)
- [x] 所有页面常驻挂载(Carousel scroll-snap 已使各页非 `display:none` 地常驻、droppable 有有效 rect;未改走 `visibility:hidden` 是因其会破坏 snap 翻页 UX——满足 ADR-0003 的真实约束「不可 display:none」,见 DashboardPage 注释)
- [x] `onDragEnd` 同页重排:乐观更新(复用 `moveIcon` reducer)+ 调 `PATCH /api/icons/move` 持久化
- [x] Vitest 纯函数测试:`iconReducer.ts` 的 `moveIcon`(11 例,含同页前后移/末尾/边界夹取/不可变/跨页隔离)
- [x] 拖拽视觉反馈(spec user story 35):`DragOverlay` 渲染 `<Icon overlay>` 跟随光标,原位降级为占位(opacity 0.4 + ring)
- [ ] 验证(手动):编辑模式下拖拽图标在同页内重排,刷新后顺序保持 —— 代码路径已通(tsc/测试/构建绿),需运行态手测
