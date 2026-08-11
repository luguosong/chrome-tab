# 07 — 跨页拖拽 + 边缘自动翻页

**What to build:** 在同页拖拽(06)基础上实现跨页移动。`onDragOver` 检测 `over.data.current.sortable.containerId` 与 active 的 pageId 不同时,执行跨页移动(图标跟随光标进入新页的 SortableContext)。屏幕左右边缘各设一个 `useDroppable` 区域,拖到边缘停留约 400ms 触发走马灯 `goTo(currentIndex ± 1)` 翻到相邻页,实现连续的跨页移动体验。目标页已满时拒绝(容量校验)。最终位置在 `onDragEnd` 持久化。

遵循 ADR-0003。

**Blocked by:** 06 — 同页拖拽(06)(跨页建立在同页拖拽基建之上)

**Status:** code-complete(待手动验证)

- [x] 左右边缘 `useDroppable` 区域(id=`edge-left`/`edge-right`)— `Carousel.EdgeDropZone`
- [x] `onDragOver`:over.id 为边缘 droppable 且停留达 ~400ms → `carousel.goTo(currentIndex ± 1)` — 实现位置:边缘 400ms 计时器放在 `EdgeDropZone` 内部(基于 dnd-kit `isOver` 的 `useEffect`),而非 DashboardPage 的 `onDragOver`;功能等价(DashboardPage 的 `onDragOver` 见到边缘 id 直接放行,翻页交由 EdgeDropZone 自管)。持续停留则每 400ms 连续翻页(契合"连续跨页体验")。
- [x] `onDragOver`:over 的 containerId 与 active pageId 不同 → 跨页移动图标到目标页(目标页满则拒绝并提示)— 容量用 `canFit` 预校验,满则底部浮层提示"目标页已满,无法移入"
- [x] 跨页移动时图标跟随光标进入新页网格(视觉连续)— `onDragOver` 内 `qc.setQueryData(moveIcon(...))` 把被拖项写进目标页 SortableContext
- [x] `onDragEnd` 持久化最终跨页位置,调 `PATCH /api/icons/move` — 跨页分支按缓存最终态 `moveIconMut.mutate`;`onDragCancel` 整份回写 dragStart 快照撤销乐观写入
- [x] Vitest 纯函数测试:`iconReducer.ts` 的 `moveIcon` 跨页分支(纯 reducer)— `iconReducer.test.ts` 新增 7 例(移到非空中段/空页/追加/夹断/源页留洞/来回/不可变)
- [ ] 验证:编辑模式下把图标拖到屏幕边缘翻到相邻页并落入,刷新后位置保持;目标页满时被拒 — **待手动验证**(已知限制:目标页为空页时,因无 sortable 项供 `over` 命中,边缘翻过去后无法触发跨页落入;非空目标页正常)
