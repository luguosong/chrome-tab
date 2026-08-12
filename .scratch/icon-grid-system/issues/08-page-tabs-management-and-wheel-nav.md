# 08 — 页面管理:常驻页签条 + 新建/改名/删页 + 滚轮翻页

**What to build:** 实现页面作为一等公民的管理交互。常驻 `PageTabs` 页签条:点击切换页面、拖拽页签重排顺序(调 `PATCH /api/pages/reorder`)。编辑模式下提供页面管理:新建页(调 `POST /api/pages`)、重命名(调 `PUT /api/pages/{id}`)、删除空页(非空页 409 阻止,见 04)。滚轮事件绑定到页面切换而非页面内滚动,键盘 ←→ 切换页面,确保页面内容始终在视口内不产生纵向滚动条。

遵循 ADR-0002(固定画布)、`CONTEXT.md`(页面)。

**Blocked by:** 04 — 后端页面写 API(04)(增删改名/重排需要端点)

**Status:** done (提交 `3c82f81`)

- [x] 常驻 `PageTabs` 组件:显示各页名称,点击切换,高亮当前页
- [x] 页签拖拽排序(HTML5 drag,调 `PATCH /api/pages/reorder`)
- [x] 页签条超出宽度时横向滚动(页数无上限)
- [x] 编辑模式内页面管理入口:新建页(输入名)、重命名(双击页签)、删除空页
- [x] 删非空页时显示后端 409 提示("该页非空,请先移动或删除页内图标")
- [x] 滚轮事件绑定到页面切换(走马灯 `goTo`),阻止页面内纵向滚动
- [x] 键盘 ←→ 切换页面(Carousel 既有,保留)
- [x] 验证:页面内容在视口内完整呈现,无纵向滚动条(`h-screen overflow-hidden`);新建/改名/删空页/重排均生效并持久化
- [x] 验证:滚轮翻页流畅,不与拖拽(06/07)的 PointerSensor 冲突(PageTabs 用 HTML5 DnD,wheel 与 pointer 不同事件流)

## Notes
- 拖拽选 HTML5 DnD 而非 `@dnd-kit`(issue 明确允许):PageTabs 与 06/07 图标拖拽机制独立,避免提前引入/重复调参 @dnd-kit,也天然规避 PointerSensor 冲突。
- Carousel 上下文由 `{goTo}` 扩为 `{active,goTo}`;用 `<PageTabs/>` 替换原圆点指示器。
- 滚轮:`|deltaY| > |deltaX|` 才接管(纵向鼠标翻页+preventDefault),横向(触控板横扫)交给原生 snap;400ms 节流防一次手势连翻。
- Page CRUD:新建/改名/删除走 invalidate-on-success;重排走乐观更新(拖拽视觉跟随)。删非空页 409 经 `ApiError.message` 直接展示后端文案。
- 纯逻辑 `moveItem<T>` 抽在 `lib/arrayUtil.ts` 并 Vitest 单测(对齐 `lib/*.test.ts` 先例)。
- 待 follow-up:Carousel↔PageTabs 存在 import 循环(标准 provider 模式,运行时无碍);code-review 建议后续可提取 `context/CarouselContext.tsx` 解耦,本 ticket 因并行编辑未做。
