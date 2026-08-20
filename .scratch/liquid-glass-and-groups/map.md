Label: wayfinder:map
Status: done(2026-08-19 目的地抵达:spec + ADR-0011/0012 + CONTEXT.md + 实现票 06–12 全部落库,见 05)

# Liquid Glass 全 UI 重塑 + 导航分组

## Destination

一份可执行的 spec(`.scratch/liquid-glass-and-groups/spec.md`)+ 新 ADR(分组模型、Liquid Glass 视觉体系)+ 实现用 issue 拆分,交给后续执行 session 落地两件事:

1. 整个新标签页 UI(图标层 + 外围 chrome)按 **iOS 26 Liquid Glass** 风格整体重做,风格一致;
2. nav 图标分组:编辑模式拖拽合并成组、打开、移出、解散。

## Notes

- **视觉参照:iOS 26 Liquid Glass(液态玻璃)。明确不参考旧版 iOS 拟物风格。**
- 领域词汇以根 `CONTEXT.md` 为准;ADR 放 `docs/adr/`,下一号为 0011。
- 测试哲学沿用 icon-grid-system spec:只测外部行为;纯逻辑抽纯函数(Vitest),后端契约 `@SpringBootTest`+H2,拖拽与视觉手动验证。
- 分组随既有双端镜像整体-blob LWW 同步(ADR-0006)走,无新增同步机制;备份 `schemaVersion` 需 bump。
- 既有基建:8×8 网格、@dnd-kit(ADR-0003)、类型注册表(ADR-0001)、页面容量(ADR-0002)。
- 研究结论资产放在 `research/<name>` 分支(throwaway),对应 ticket 内有指针。
- 每张票开工前先读本文档;讨论类票配 grilling + domain-modeling 技能。

### 建图期已定决策(2026-08-19,grilling 定稿)

1. nav 图标 = app 图标式 squircle 玻璃底板 + 下方名称。
2. stock/weather/changelog = iOS 26 小组件(widget)风格,内容布局一并重排,不止换容器。
3. 分组图标 = iOS 文件夹式:玻璃容器 + 3×3 迷你 favicon 预览 + 名称。
4. 范围 = 整个新标签页 UI(搜索框/页签条/时钟/抽屉/Modal 全部)一起 Liquid Glass 化,整体一致。
5. 只有 nav 类型能进组;进组时 size 属性保留,组内统一迷你渲染,拖出后按原尺寸落回。
6. 组固定占 1×1、不可切尺寸;子图标不计页面容量(组自身按 1 格计)。
7. 组 = 一种图标行(`type='group'`,走注册表渲染)+ 新增可空 `parent_id` 列(ADR 级决策)。
8. 建组手势 = 编辑模式拖 A 悬停到 B 合并;查看模式拖拽不建组。
9. 打开组 = 暗化背景居中弹层,点外部关闭;点子图标 = 触发其默认行为后关闭。
10. ~~组上限 9 个~~(**04 修订:取消上限**)——组内成员线性序列无上限,弹层按 9/页自动流式分页、滚轮翻组内页;默认名「新建分组」,打开态点名称即改名(不限编辑模式)。
11. ~~移出 = 打开态拖子图标到页面~~(**04 修订:组内排序/拖出仅编辑模式**);最后一个移出 → 组自动消失;编辑模式 × = 解散洒回本页,不删子图标。
12. AddDrawer 不出现「分组」类型;组只由合并手势诞生。
13. 无嵌套组;编辑模式入口右键为主,长按入口阈值细节留给实现票。
14. 既有交互语义(点击/拖拽/编辑模式,icon-grid 成果)不变,只叠加不改写。

## Decisions so far

- [01 · 调研:iOS 26 Liquid Glass 设计规范与 Web 复刻技法](issues/01-liquid-glass-spec-and-web-techniques.md) — Apple 只有 regular/clear 两档;Chromium 108+ 支持 `backdrop-filter: url(#svg)` 真折射;产出 L0/L1/L2 三档参数表,两步走(先纯 CSS,折射档先验证);不引库。铁律「玻璃只给功能层、禁叠放」与本项目图标坐玻璃页板有张力,留原型票验证。结论在 `research/liquid-glass` 分支。
- [02 · 调研:dnd-kit 弹层内拖出到页面网格的方案](issues/02-dnd-overlay-drag-out.md) — 单一根 DndContext(不嵌套),分组弹层 = 官方 MultipleContainers 模式的"第 N+1 个容器",零新范式;最大坑是暗化 backdrop 必须 `pointer-events:none`。结论在 `research/dnd-overlay-drag-out` 分支。
- [03 · 原型:Liquid Glass 视觉原型](issues/03-liquid-glass-visual-prototype.md) — **用户裁决方向 C**:保留 L0 页板 + 图标坐页板(soft 玻璃底板,glass-on-glass 叠放放行)+ 搜索框/页签条/胶囊升 L2 SVG 折射(`backdrop-filter:url()` 实测生效);A 裸壁纸方向否决。widget iOS 小组件式排版、squircle 24%、页签 active 实心白无异议。材质参数候选落定(票 05 进 spec)。原型在 `prototype/liquid-glass` 分支。
- [04 · Grilling:spec 定稿评审](issues/04-spec-grilling.md) — 三轮收口:ADR 拆 **0011 分组模型 + 0012 Liquid Glass**;组内交互仅编辑模式、解散/加入/落位/容量语义定案;**组上限 9 取消**,改线性序列 9/页自动流式分页、滚轮翻组内页;API = merge/dissolve 专用端点 + move 扩展 parentId;V7 自引用 FK(RESTRICT)、schemaVersion 1→2 无转换器;切票 7 张(06–12,数据/交互/视觉三轴);手势参数留实现票。
- [05 · 落笔:spec + ADR + CONTEXT.md 术语 + issue 拆分](issues/05-write-spec-adr-issues.md) — spec / ADR-0011 / ADR-0012 / CONTEXT.md 修订 / 实现票 06–12 全部落库(经三视角对抗校验修订),**目的地抵达、map 关闭**。落笔期消化:备份 wire 图标增 `id` + iconIdMap(现 wire 无 id,parentId 重建后悬空)、全删改先子后父两段(RESTRICT 即时检查)、空组不存活统一语义、导入双接受 v1/v2、时钟需重新挂载(现为未挂载遗留组件)。

## Not yet specified

(无——05 落笔完成,目的地抵达;实现执行走 `issues/06–12`,不在本图范围内。)

## Out of scope

- 组嵌套(组里套组)。
- 非 nav 类型(stock/weather/changelog)进组。
- 组可切换尺寸(固定 1×1)。
- 基于分类的自动命名(无分类数据源)。
- AddDrawer 提供新建空分组入口。
- 分组的导入导出/模板化等页面级能力。
- 图标配置编辑能力的扩展(沿用现有 ✎ 编辑)。
