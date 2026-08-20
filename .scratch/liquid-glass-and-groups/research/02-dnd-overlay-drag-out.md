# 调研:dnd-kit 弹层内拖出到页面网格 (02-dnd-overlay-drag-out)

- 票:`.scratch/liquid-glass-and-groups/issues/02-dnd-overlay-drag-out.md`
- 日期:2026-08-19;项目版本:`@dnd-kit/core ^6.3.1` / `@dnd-kit/sortable ^10.0.0` / `@dnd-kit/utilities ^3.2.2`(frontend/package.json)
- 版本/维护状态(来源:npm registry):core 最新 6.3.1(2024-12-05 发布),sortable 最新 10.0.0(2024-12-04)。classic 包稳定但迭代慢;官方正在开发新一代 `@dnd-kit/react`(新文档 dndkit.com/react/*,API 有变,如 `droppable.shape`)。**本项目锁 6.x classic API,本调研全部引用 legacy 文档与 master 分支源码。**

## 结论摘要 (TL;DR)

1. **推荐:单一根 DndContext(现状不动),分组弹层 portal 渲染但保持在根 DndContext 的 React 子树内,弹层内加一个 SortableContext,即"又一个容器"。** 维护者明言嵌套 DndContext 之间事件不通,"best way is a single `<DndContext>` provider"(discussion #766)。
2. **portal 对碰撞检测无害**:dnd-kit 全部用 `element.getBoundingClientRect()`(视口坐标)测量,DOM 挂载位置不影响;React portal 子树照常消费祖先 context(react.dev 明文)。官方 MultipleContainers 示例自己就把 DragOverlay `createPortal` 到 `document.body`。
3. **跨容器搬移模式照抄官方示例**:onDragOver 里检测 `activeContainer !== overContainer` 就 setState 乐观搬移,onDragEnd 收尾持久化,onDragCancel 回滚快照。**本项目 DashboardPage 已经为跨页拖拽实现了同一套**,新增分组只是多一个容器维度。
4. 最大风险不在 dnd-kit 而在**弹层暗化背景挡住背后的页面网格**:拖拽期间背景必须 `pointer-events: none`(或干脆常态 none),否则拖出弹层后 pointer 命中的仍是 backdrop,页面网格 droppable 永远不会被 over。
5. 弹层显隐策略:**拖拽期间绝不卸载弹层/被拖项**;`onDragEnd` 时若最终容器是页面网格再关闭弹层(而非拖出瞬间关)。

---

## 1. 单一 DndContext + Portal 的可行性(坐标/碰撞检测)

**可行,且是官方示例同款结构。** 依据:

- **测量坐标与 DOM 位置无关**:core 源码 `packages/core/src/utilities/rect/getRect.ts` 的 `getClientRect()` 直接调 `element.getBoundingClientRect()`,返回视口坐标系下的 `{top,left,width,height,bottom,right}`。所有 droppable(无论是否 portal 渲染)都在同一视口坐标系里比较,portal 挂到 `document.body` 不产生坐标偏差。
  - 源:https://raw.githubusercontent.com/clauderic/dnd-kit/master/packages/core/src/utilities/rect/getRect.ts
- **React context 穿透 portal**:react.dev 文档:"A portal only changes the physical placement of the DOM node. … the child can access the context provided by the parent tree, and events bubble up from children to parents according to the React tree." 因此 `createPortal(<GroupModal/>, document.body)` 只要写在根 `DndContext` 的 React 子树里,弹层内的 `useSortable/useDroppable` 照常向根 context 注册。
  - 源:https://react.dev/reference/react-dom/createPortal
- **DragOverlay 与视口对齐**:legacy 文档:"The `<DragOverlay>` component provides a way to render a draggable overlay that is removed from the normal document flow and is positioned relative to the viewport." zIndex 默认 999(官方建议调低);默认**不**portal 渲染,"it is rendered in the container where it is rendered",可用 `createPortal` 挪到 `document.body`。官方 MultipleContainers 示例正是 `createPortal(<DragOverlay …/>, document.body)`。
  - 源:https://dndkit.com/legacy/api-documentation/draggable/drag-overlay
- **前置条件(唯一硬约束)**:portal 内容必须在根 DndContext 的 React 子树内。若弹层组件渲染在 DndContext 之外(比如挂在路由外层的全局 Modal Host),`useSortable` 拿不到 context 会静默失效——需把 portal 调用点放进 DashboardPage 的 DndContext 内。issue #58 标题即"Difficult to manage drags across sections of the app"(DndContext 需放得足够高)。
  - 源:https://github.com/clauderic/dnd-kit/issues/58
- 已知 portal 相关怪例:issue #827(报告者:"It's strange because the Modal component is a portal, which means it's not inside the draggable element's DOM"——portal 反而被父 draggable 的拖拽波及)。方向与本场景相反,仅说明 portal 与 dnd-kit 事件合成有边角问题,不影响"portal 内 sortable 注册到根 context"这条主结论。
  - 源:https://github.com/clauderic/dnd-kit/issues/827

## 2. 官方 multiple containers 模式剖析(onDragOver 跨容器搬移 + onDragEnd 收尾)

源码逐行核实自官方 storybook 示例(非转述):
https://raw.githubusercontent.com/clauderic/dnd-kit/master/stories/2%20-%20Presets/Sortable/MultipleContainers.tsx

结构:**一个 DndContext + N 个容器**;每个容器是一个 `useSortable({id: 容器id, data:{type:'container'}})` 的 `DroppableContainer`,内部再包 `<SortableContext items={…} strategy={…}>` 渲染子项。空容器天然保留(容器 droppable 仍在注册表中)。

### 碰撞检测(自定义组合)

```ts
// 官方 collisionDetectionStrategy 摘要
if (activeId 是容器) return closestCenter({…args, droppableContainers: 只留容器});
const pointerIntersections = pointerWithin(args);           // 指针所在容器优先
const intersections = pointerIntersections.length > 0
  ? pointerIntersections : rectIntersection(args);          // 兜底矩形相交
let overId = getFirstCollision(intersections, 'id');
if (overId 是容器 id && 该容器非空) {
  overId = closestCenter({…args, droppableContainers: 只留该容器的子项})[0]?.id;
}
// 命不中时返回 lastOverId.current(记忆最近一次命中,防抖);
// recentlyMovedToNewContainer.current 为 true 时回退 activeId(刚跨容器搬移后的稳定化)
```

要点:pointer 命中容器 → 再在该容器内用 closestCenter 选具体子项;"记忆最近 over" + "刚搬移标记"是官方对**跨容器搬移后布局抖动**的稳定化手段。

### 事件处理三段式

```ts
// onDragStart:setActiveId(active.id); setClonedItems(items)  // 快照供取消回滚
// onDragOver:
const overId = over?.id;
if (overId == null || …特殊id) return;              // 守卫 1:无目标早退
const overContainer = findContainer(overId);        // id → 所属容器
const activeContainer = findContainer(active.id);
if (activeContainer !== overContainer) {            // 守卫 2:仅跨容器才 setState
  setItems(items => ({                              // 乐观搬移(追加到目标容器末位或按 over 位置插入,
    …items,                                         // 用 isBelowOverItem ? +1 : 0 修正插入位)
    [activeContainer]: 去掉 active.id,
    [overContainer]:   插入 active.id,
  }));
  recentlyMovedToNewContainer.current = true;
}
// onDragEnd:findContainer 双方同容器 → arrayMove 收尾;处理 trash/placeholder 等特殊 id;setActiveId(null)
// onDragCancel:恢复 clonedItems;setActiveId(null)
```

`findContainer` 就是官方示例的容器归属 helper:

```ts
const findContainer = (id) => id in items ? id : Object.keys(items).find(k => items[k].includes(id));
```

legacy DndContext 文档对职责边界的表述:"the `onDragEnd` event does not move draggable items into droppable containers… It is up to the consumer of `DndContext` to decide… updating (or not) its internal state"。即**跨容器移动是消费方在 onDragOver 里自己做乐观 state 搬移**,框架不代劳。onDragOver 语义:"Fires when a draggable item is moved over a droppable container"。
源:https://dndkit.com/legacy/api-documentation/context-provider/dnd-context

### DragOverlay 与动态/空容器组合

- 官方示例 `createPortal(<DragOverlay adjustScale dropAnimation>{activeId ? … : null}</DragOverlay>, document.body)`:内容随 activeId 条件渲染,DragOverlay 外壳常驻。文档强调 "The `<DragOverlay>` component should remain mounted at all times so that it can perform the drop animation"(本项目已用 `dropAnimation={null}`,无此约束)。
- 空容器:容器本身是 useSortable droppable,子项搬空后容器仍可被 over(pointerWithin 命中容器 id)→ 官方在 onDragOver 中 `overId in items`(即容器)时 `newIndex = overItems.length + 1` 追加到末位。**本项目 IconGrid 已有同型实现:空页挂 `useDroppable(id=页id, data.type='page')`,图标乐观移入后由 SortableContext 接管**(frontend/src/components/IconGrid.tsx:100-103 注释明说)。

## 3. Nested DndContext 的已知问题

**结论:别嵌套。** 核心一手证据 discussion #766("What use is there to nesting DndContext if events don't go through"):

- 提问者:"all my events (onDragStart, onDragEnd) are stopped at Context 3 and will never reach Context 1 or 2" —— **嵌套 context 间事件不传播,内层吞掉事件**。
- 维护者 clauderic:"Currently, the best way to do this is to have a single `<DndContext>` provider";"I don't foresee it being possible to communicate across DndContext boundaries any time soon"。给出的正规替代:单一 provider + 按 active 元素类型动态切换 modifiers/DragOverlay 内容("leverage the `data` property of useDraggable and useSortable to store modifiers"),配 `useDndMonitor()` 在局部组件里订阅拖拽事件而非层层上抛。
  - 源:https://github.com/clauderic/dnd-kit/discussions/766
- 相关佐证(标题经搜索核实,正文未逐条核):#1570(父 DndContext 跨列表 + 嵌套子 context 冲突)、#1357(嵌套 droppable 讨论)、#821(嵌套多容器讨论)。嵌套 context 仅在**各 context 完全独立、互不跨界拖**时才正常——与"弹层↔页面互拖"需求直接矛盾。

## 4. 跨容器时序与弹层显隐/背景穿透策略

### 时序(以一次"拖出弹层→落页面网格"为例)

```
onDragStart(active=子图标)          → setActiveId、快照当前 items(官方 clonedItems;本项目=整份聚合缓存快照)
onDragOver × N (over 从弹层内子项 → 页面网格子项/页 droppable)
    首次 activeContainer ≠ overContainer → setState 乐观把图标从分组容器数组搬进页数组
    (此后 over 的 containerId 变了,后续 onDragOver 命中同容器守卫 → 不再 setState)
onDragEnd(active, over)             → 最终 arrayMove 定位 + 持久化;setActiveId(null);此处决定关不关弹层
onDragCancel(ESC)                   → 回滚整份快照
```

已知坑(全部有 issue 佐证):onDragOver 里 setState 是官方钦定做法但易翻车——#735 拖入另一容器触发接收方无限渲染循环;#1421 "Multiple containers: possibility of hitting minified error due to setState in onDragOver";#1465 元素在两个容器间来回跳(ping-pong)。防御 = 官方示例的三个守卫(overId 判空、同容器早退、同值 setState 让 React bail-out)。

### 弹层显隐

- **拖拽期间保持弹层挂载**:被拖项的 SortableContext/容器中途卸载会打断测量与 over 计算;官方示例从不中途卸载容器。弹层空了也照常渲染空容器(SortableContext items=[],容器 droppable 仍在)。
- **关闭时机放 onDragEnd**:发现 active 最终容器是页面网格(非分组容器)→ 关闭弹层。"拖出边界瞬间关弹层"会让拖拽目标容器突变、onDragEnd 拿到的 over 不可靠,不推荐。
- 取消(ESC/pointer 出窗)走 onDragCancel 回滚,弹层保持开。

### 背景穿透(暗化 backdrop)

- dnd-kit 的 pointer 类碰撞检测看的是**指针几何位置**(pointerWithin 等),但 DOM 事件仍要能落到监听节点——backdrop 若 `pointer-events: auto` 且盖满视口,pointer 命中的永远是 backdrop,页面网格 droppable 不会被 over。**解法:拖拽期间(dragActive 时)给 backdrop `pointer-events: none`;更简单的是 backdrop 常态 `pointer-events: none`,仅弹层内容区可交互。** DragOverlay 视口定位 + 高 zIndex,不受 backdrop 层级影响。
- 相关联证据:issue #1730(shadcn Dialog + dnd-kit,关弹层后整页 "stops being clickable"——overlay/pointer-events 残留类问题的真实案例,正文无根因分析,防御:onDragEnd/onDragCancel 里做清理);issue #1870(模态内拖拽引发屏幕阅读器焦点问题,键盘可及性边角)。Zendesk Garden react-components v8 changelog 有真实产品先例 "fix(modals): allow pointer-events to pass through fading backdrop"(经搜索摘要核实,未读原文,供模式佐证)。
- 本场景有一个天然简化:**弹层居中,页面网格在四周仍可见**,用户拖到弹层外的暗化区域即可见网格高亮——无需"穿过 backdrop 看"的视觉问题,只需事件穿透。

## 5. 推荐实现方案(结合本项目现状)

**单一根 DndContext(现状),分组弹层 = 第 N+1 个容器。** 理由:维护者钦定单 provider(#766);官方 multiple containers 示例即此结构;**DashboardPage 已为"多页容器"完整实现同一套机制**(自定义 collisionDetection `pointerWithin→rectIntersection→closestCorners`、onDragOver 乐观跨页搬移、onDragEnd 持久化、onDragCancel 整份回滚,frontend/src/routes/DashboardPage.tsx:44-57,162-262),新需求是零新范式的增量。

组件结构(伪代码):

```tsx
// DashboardPage.tsx(现有 DndContext 内,DragOverlay 旁)
<DndContext sensors collisionDetection={collisionDetection} onDragStart… onDragOver… onDragEnd…>
  <Carousel>…每页 IconGrid(SortableContext id=页id)…</Carousel>
  {groupModal && createPortal(<GroupModal pageId groupId icons/>, document.body)}  // ← portal 调用点在 DndContext 子树内
  <DragOverlay dropAnimation={null}>…</DragOverlay>
</DndContext>

// GroupModal.tsx
<div className="fixed inset-0 z-40" style={{pointerEvents: 'none'}}>      {/* backdrop:纯视觉 */}
  <div style={{pointerEvents: 'auto'}}>                                   {/* 内容区恢复交互 */}
    <SortableContext id={groupId} items={childIds} strategy={rectSortingStrategy}>
      {childIds.map(…useSortable 子图标…)}
    </SortableContext>
  </div>
</div>
```

事件处理增量(在 DashboardPage 现有 handler 上加"分组容器"维度;照官方 findContainer 思路):

```ts
// collisionDetection:现有策略基本够用(pointerWithin 先命中弹层内容区内子项;
// 拖出弹层后 pointer 落到 backdrop——backdrop pointerEvents:none 且不是 droppable,不影响 over 计算;
// 若弹层内容区与页面网格 rect 重叠导致误命中,再加官方示例的"over 是容器时深入其子项 closestCenter"一层)

// onDragOver(扩展现有跨页判断):
const overContainer  = findContainer(over?.id)   // 'page:3' | 'group:5' | undefined
const activeContainer = findContainer(active.id) // 被拖图标当前在哪个容器
if (overContainer && activeContainer && overContainer !== activeContainer) {
  moveIconOptimistic(active.id, overContainer)   // 复用 moveIcon reducer,同现有跨页路径
}

// onDragEnd:
if (最终容器是页面) { 持久化; 若 active 原属分组且已移出 → setGroupModal(null) }
// onDragCancel:现有整份回滚照旧;弹层保持开
```

与官方示例的两处刻意差异(均为本项目已有约定,不必改):(a) 本项目不用 clonedItems 局部快照而是整份聚合缓存回滚(DashboardPage.tsx:117-121);(b) `dropAnimation={null}`(DashboardPage.tsx:375),DragOverlay 无需常驻顾虑。

## 6. 已知坑清单

1. **弹层 portal 必须在根 DndContext 的 React 子树内**,否则 useSortable 拿不到 context 静默失效。[react.dev createPortal;#58]
2. **backdrop 挡事件**:盖满视口且 `pointer-events:auto` 的暗化层会让拖出弹层后 over 永远不落到页面网格。拖拽期间或常态 `pointer-events:none`(内容区单独恢复)。[#1730 症状佐证;Zendesk 先例(搜索摘要核实)]
3. **onDragOver 无 setState 守卫 → 渲染循环/报错**:必须 `overId == null` 早退 + `activeContainer === overContainer` 早退;同值 setState 靠 React bail-out。[#735、#1421、#1465;官方示例代码]
4. **跨容器搬移瞬间布局抖动**:官方用 `lastOverId` 记忆 + `recentlyMovedToNewContainer` 标记稳定碰撞结果;若拖出弹层时 over 抖动,补这两者而非改碰撞算法。[官方 MultipleContainers 源码]
5. **拖拽中卸载被拖项所属容器**(如"拖出即关弹层")会打断测量/over 序列;关闭动作放 onDragEnd。DragOverlay 本体则应常驻(用 dropAnimation 时)。[legacy DragOverlay 文档]
6. **嵌套 DndContext 事件不通**,别试;需要局部感知拖拽用 `useDndMonitor`,需要按类型换 modifiers 用 `data` 属性。[discussion #766 维护者原话]
7. **空容器/空分组要保留 droppable**:子图标搬空后 SortableContext items=[] 时容器本身应仍可被 over(官方容器即 useSortable;本项目空页用 useDroppable 同思路)。[官方示例;IconGrid.tsx:100-103]
8. **模态内拖拽的可访问性边角**(屏幕阅读器焦点跳模态外)已知有 issue,本项目键盘拖拽非目标时可暂缓。[#1870]
9. **坐标/层叠**:碰撞与 DragOverlay 全走视口坐标,portal/transform 祖先(走马灯的 translate!)不影响 rect 计算(getBoundingClientRect 已含 transform);但注意本项目走马灯横向位移中拖拽本就受限,分组弹层 fixed 定位不受影响。[core getRect.ts 源码]

## 参考资料列表

| URL | 用途 |
|---|---|
| https://raw.githubusercontent.com/clauderic/dnd-kit/master/stories/2%20-%20Presets/Sortable/MultipleContainers.tsx | 官方多容器示例全量源码:collisionDetectionStrategy/findContainer/onDragOver/onDragEnd/onDragCancel/DragOverlay createPortal |
| https://raw.githubusercontent.com/clauderic/dnd-kit/master/packages/core/src/utilities/rect/getRect.ts | 证明测量用 getBoundingClientRect(视口坐标) |
| https://dndkit.com/legacy/api-documentation/context-provider/dnd-context | onDragOver/onDragEnd 语义、消费方职责 |
| https://dndkit.com/legacy/api-documentation/draggable/drag-overlay | DragOverlay 渲染位置/zIndex/dropAnimation/常驻要求/viewport 定位 |
| (docs.dndkit.com/api-documentation/context-provider/collision-detection-algorithms → 301 重定向至 dndkit.com 同路径) | 内置碰撞算法语义(rectIntersection 默认、closestCorners、pointerWithin 仅指针传感器)与组合自定义 |
| https://dndkit.com/react/guides/collision-detection | 新版(@dnd-kit/react,未采用)碰撞 API,佐证新旧文档分离 |
| https://github.com/clauderic/dnd-kit/discussions/766 | 嵌套 DndContext 事件不通 + 维护者"single provider"结论 |
| https://github.com/clauderic/dnd-kit/issues/827 | portal Modal 与拖拽事件边角问题(报告者引语) |
| https://github.com/clauderic/dnd-kit/issues/1730 | Dialog+dnd-kit 关闭后整页不可点(pointer-events 残留类) |
| https://github.com/clauderic/dnd-kit/issues/1870 | 模态内拖拽的可访问性焦点问题 |
| https://github.com/clauderic/dnd-kit/issues/735、#1421、#1465、#58、#1570、#1357、#821 | onDragOver setState 循环/报错/容器间 ping-pong;DndContext 放置高度;嵌套讨论(标题经搜索核实,#735/#1421/#1465 未逐条读正文,结论以官方示例守卫代码为准) |
| https://react.dev/reference/react-dom/createPortal | portal 保留 React 树 context 与事件冒泡 |
| npm registry @dnd-kit/core、@dnd-kit/sortable | 版本与发布日期(6.3.1 / 2024-12-05;10.0.0 / 2024-12-04) |
| 本仓库 frontend/src/routes/DashboardPage.tsx、frontend/src/components/IconGrid.tsx | 项目现有 DnD 实现基线 |
