# 11 — 外围 chrome 换肤:搜索框/页签条/胶囊/箭头 L2 + 时钟裸排

Type: task
Status: ready-for-agent
Blocked by: 09 — LensBox

**What to build:** 页面外围 chrome 升 **L2 折射档**(套 09 的 `LensBox`):搜索框(`SearchBox.tsx`)、页签条(`PageTabs.tsx`)、右上胶囊与翻页箭头(`DashboardPage.tsx` 内联区 / `Carousel.tsx` 箭头)。页签 **active 态 = 实心白凸起**(非玻璃,原型已裁决)。**时钟回归页面顶部**:`Clock.tsx` 现为未挂载的遗留组件(顶部常驻仅搜索框),重新挂载到顶部常驻区并按 **iOS 锁屏式大字裸排**呈现(组件现状已是裸大字,主要工作是挂载落位与排版校准;不上玻璃)。`Background.tsx` 压暗遮罩按明/暗壁纸校准,保证 L2 近透明底上内容对比度(必要时按参数表叠官方唯一数值的 35% 暗色调光层)。走马灯滚动 / 编辑模式 / 拖拽中 chrome 不闪烁。

遵循 ADR-0012;原型参照 `prototype/liquid-glass` 分支(@ `3f10ddf`)。

**工具:** 实现时使用 ui-ux-pro-max 插件——动工前 Skill 调用 `ui-ux-pro-max:ui-ux-pro-max`(UI/UX 设计智能);涉及 Tailwind 样式细节可配 `ui-ux-pro-max:ui-styling`。

- [ ] 搜索框 L2(LensBox)
- [ ] 页签条 L2 容器 + 页签项;active = 实心白凸起
- [ ] 右上胶囊(+/⚙/用户名/登出)与左右翻页箭头 L2
- [ ] 时钟重新挂载到顶部常驻区 + iOS 锁屏式大字裸排
- [ ] 明/暗壁纸下对比度校准(遮罩 / 调光层)
- [ ] 验证:滚动走马灯、进出编辑模式、拖拽图标时 chrome 无闪烁回归 — **待手动验证**
