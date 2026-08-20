# 10 — 图标层换肤:nav squircle + widget 小组件排版 + 分组样式

Type: task
Status: ready-for-human
Blocked by: 09 — 材质 token 与 LensBox
落地:4687c72 + review 修订 fbe8e80(代码/测试/双轴 review 完成;余 1 项实机手动走查)

**What to build:** 图标网格内全部元素换肤(**不止换容器,内容排版一并重做**)。nav 图标 = app 图标式 squircle 玻璃底板(soft 档:`blur(6px) saturate(150%)`、`rgba(255,255,255,0.16)`、圆角 24%)+ 名称外置(下方),favicon 居中;编辑模式抖动、入场动画、DragOverlay 保持不回归。widget 按 iOS 小组件语言重排——**stock / weather 已有按尺寸分档的专属布局**(`StockIcon.tsx` 三档、`WeatherIcon.tsx` 三档),本票是重排为小组件式信息层级(大数字、主信息、留白),不是从零;changelog 从通用密度重做:**stock** = 大价格 + sparkline(按尺寸分档密度,沿用 ADR-0007 三档);**weather** = 城市 + 大温度 + 状况;**changelog** = 版本列表。分组图标 = iOS 文件夹式:玻璃容器 + 3×3 迷你预览 + 名称外置(渲染结构 07 已建,本票定材质细节)。所有玻璃底板坐 L0 页板——glass-on-glass 已裁决放行(ADR-0012)。排版方向的原型参照:`prototype/liquid-glass` 分支(@ `3f10ddf`,variant C)。

遵循 ADR-0012(材质参数表);密度语义见 ADR-0007。

**工具:** 实现时使用 ui-ux-pro-max 插件——动工前 Skill 调用 `ui-ux-pro-max:ui-ux-pro-max`(UI/UX 设计智能);涉及 Tailwind 样式细节可配 `ui-ux-pro-max:ui-styling`。

- [x] nav squircle soft 底板 + 名称外置;「布局设置」iconScale 三档缩放正常
- [x] stock 小组件排版:大价格 + sparkline,三档密度
- [x] weather 小组件排版:城市 / 大温度 / 状况
- [x] changelog 小组件排版:版本列表
- [x] 分组图标材质:玻璃容器 + 3×3 迷你预览 + 名称外置(注:原以为「渲染结构 07 已建」,
      实际 07 与本票同期落地;07 建结构(bg-white/15 占位),本票定稿材质 glass-soft +
      圆角 30% + 边长 fav×1.5 与 nav squircle 等大)
- [x] 编辑模式抖动、拖拽 DragOverlay、空页落点 / 容量角标不回归(tsc/vitest 177 全绿
      + build 通过;代码路径未动,待实机复核)
- [ ] 验证:真实壁纸 + 明/暗壁纸各走查一遍全部类型与尺寸 — **待手动验证**
