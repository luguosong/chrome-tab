# 07 — 跨页拖拽 + 边缘自动翻页

**What to build:** 在同页拖拽(06)基础上实现跨页移动。`onDragOver` 检测 `over.data.current.sortable.containerId` 与 active 的 pageId 不同时,执行跨页移动(图标跟随光标进入新页的 SortableContext)。屏幕左右边缘各设一个 `useDroppable` 区域,拖到边缘停留约 400ms 触发走马灯 `goTo(currentIndex ± 1)` 翻到相邻页,实现连续的跨页移动体验。目标页已满时拒绝(容量校验)。最终位置在 `onDragEnd` 持久化。

遵循 ADR-0003。

**Blocked by:** 06 — 同页拖拽(06)(跨页建立在同页拖拽基建之上)

**Status:** code-complete(待手动验证)

> 2026-08-11 验证补充:`PATCH /api/icons/move` 跨页移动路径已端到端验证(P1 首项移到 P2 首位 → GET 重读确认跨页 + 落库 → 还原,均 PASS)。边缘 EdgeDropZone 400ms 自动翻页 + 拖拽跨页落入的运行态 UX 未手测(IAB 自动化受阻,见 06)。

- [x] 左右边缘 `useDroppable` 区域(id=`edge-left`/`edge-right`)— `Carousel.EdgeDropZone`
- [x] `onDragOver`:over.id 为边缘 droppable 且停留达 ~400ms → `carousel.goTo(currentIndex ± 1)` — 实现位置:边缘 400ms 计时器放在 `EdgeDropZone` 内部(基于 dnd-kit `isOver` 的 `useEffect`),而非 DashboardPage 的 `onDragOver`;功能等价(DashboardPage 的 `onDragOver` 见到边缘 id 直接放行,翻页交由 EdgeDropZone 自管)。持续停留则每 400ms 连续翻页(契合"连续跨页体验")。
- [x] `onDragOver`:over 的 containerId 与 active pageId 不同 → 跨页移动图标到目标页(目标页满则拒绝并提示)— 容量用 `canFit` 预校验,满则底部浮层提示"目标页已满,无法移入"
- [x] 跨页移动时图标跟随光标进入新页网格(视觉连续)— `onDragOver` 内 `qc.setQueryData(moveIcon(...))` 把被拖项写进目标页 SortableContext
- [x] `onDragEnd` 持久化最终跨页位置,调 `PATCH /api/icons/move` — 跨页分支按缓存最终态 `moveIconMut.mutate`;`onDragCancel` 整份回写 dragStart 快照撤销乐观写入
- [x] Vitest 纯函数测试:`iconReducer.ts` 的 `moveIcon` 跨页分支(纯 reducer)— `iconReducer.test.ts` 新增 7 例(移到非空中段/空页/追加/夹断/源页留洞/来回/不可变)
- [ ] 验证:编辑模式下把图标拖到屏幕边缘翻到相邻页并落入,刷新后位置保持;目标页满时被拒 — **待手动验证**
- [x] **空页落入(原已知限制,已修复 2026-08-12)**:空页无 sortable 项 → dnd-kit 无 droppable 矩形 → `over` 不命中 → 无法跨页落入。修复:`IconGrid` 空页分支包页级 `useDroppable`(id=页 id,`data.type='page'`);`handleDragOver` 新增 `type==='page'` 分支移入位序 0;`collisionDetection` 边缘 droppable 优先(光标在边缘条内时 EdgeDropZone 先赢,保证穿过空页仍可持续翻页)。待手动确认 UX。
- [x] **拖拽贴边冲到末页(已修复 2026-08-12)**:根因是 dnd-kit `DndContext` 默认 `autoScroll=true`——拖拽靠近边缘时它原生横向滚动最近的 scrollable 祖先(本应用即 `overflow-x-auto` 的走马灯),与 EdgeDropZone 翻页机制冲突并一路冲到末页。日志定位证据:拖拽时 `active` 连续变化但 `goTo`/wheel 均无调用记录,即 scrollLeft 被 dnd-kit autoScroller 改动。修复:`DndContext autoScroll={false}`(页面为固定画布、翻页由 EdgeDropZone/wheel/keys 自管,无需 dnd-kit 代劳)。另:EdgeDropZone 改为单次进入只翻一页(惰性),避免连翻无法锁定目标页。
- [x] **边缘翻页可见化(2026-08-12,UX 打磨)**:EdgeDropZone 由全高隐形条改为**居中浮动玻璃方块**(›/‹ + 充能进度条)。两层模型:外层 ~120px 接近区(pointermove 算 proximity 驱动淡入,不翻页);内层方块(useDroppable)进入→400ms 充能动画(进度条 0→100%,与计时器同步)→翻一页。纯触发(方块上松手=图标回原位,落子仍靠挪进目标页网格)。拖拽中隐藏左右箭头避免同位重叠;到首/末页该侧不挂载。
