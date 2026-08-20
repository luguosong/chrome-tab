# 11 — 外围 chrome 换肤:搜索框/页签条/胶囊/箭头 L2 + 时钟裸排

Type: task
Status: ready-for-human
Blocked by: 09 — LensBox
落地:728465e(代码/类型检查/测试完成;余 1 项为实机手动验证。工作区并行会话冲突,经 worktree 隔离提交,详见 Comments)

**What to build:** 页面外围 chrome 升 **L2 折射档**(套 09 的 `LensBox`):搜索框(`SearchBox.tsx`)、页签条(`PageTabs.tsx`)、右上胶囊与翻页箭头(`DashboardPage.tsx` 内联区 / `Carousel.tsx` 箭头)。页签 **active 态 = 实心白凸起**(非玻璃,原型已裁决)。**时钟回归页面顶部**:`Clock.tsx` 现为未挂载的遗留组件(顶部常驻仅搜索框),重新挂载到顶部常驻区并按 **iOS 锁屏式大字裸排**呈现(组件现状已是裸大字,主要工作是挂载落位与排版校准;不上玻璃)。`Background.tsx` 压暗遮罩按明/暗壁纸校准,保证 L2 近透明底上内容对比度(必要时按参数表叠官方唯一数值的 35% 暗色调光层)。走马灯滚动 / 编辑模式 / 拖拽中 chrome 不闪烁。

遵循 ADR-0012;原型参照 `prototype/liquid-glass` 分支(@ `3f10ddf`)。

**工具:** 实现时使用 ui-ux-pro-max 插件——动工前 Skill 调用 `ui-ux-pro-max:ui-ux-pro-max`(UI/UX 设计智能);涉及 Tailwind 样式细节可配 `ui-ux-pro-max:ui-styling`。

- [x] 搜索框 L2(LensBox)— radius 26,icon 左置、去 accent 实心按钮(原型裁决;回车提交,`aria-label` 已补)
- [x] 页签条 L2 容器 + 页签项;active = 实心白凸起 — 容器 LensBox radius 21;active `bg-white/75 text-zinc-900 shadow-sm`、非 active 裸文字;编辑态交互保留:重命名/删除样式照旧,+ 新建改与页签非 active 同款裸文字(轻底圆钮废弃,与容器内其余项统一)
- [x] 右上胶囊(+/⚙/用户名/登出)与左右翻页箭头 L2 — 胶囊 radius 22,由 fixed 浮层改入顶行流动布局(原型定稿);箭头 radius 22,LensBox 壳 + 内层 button(HTML 内容模型合法)
- [x] 时钟重新挂载到顶部常驻区 + iOS 锁屏式大字裸排 — 顶行居左;`text-5xl` + 副行 `text-xs` 无年份 + 双层 text-shadow(原型 `.plx-clock` 参数)
- [x] 明/暗壁纸下对比度校准(遮罩 / 调光层)— 亮档遮罩 25%→35%(Apple clear 档官方唯一公开数值),暗档 45% 维持
- [ ] 验证:滚动走马灯、进出编辑模式、拖拽图标时 chrome 无闪烁回归 — **待手动验证**(静态核对:滚动/拖拽路径页签条与箭头尺寸不变、不触发贴图重建;进出编辑模式时页签条因 + 按钮出现/消失有一次贴图重建,首帧 `lens-fallback`(blur 2)与折射态视觉接近,预期不可感——以实机为准)

## Comments

- **取舍记录(2026-08-20):** 搜索框去掉原 accent 暖色实心按钮、icon 左置——对齐原型定稿视觉(整条 chrome 无暖色焦点);提交仍可回车。箭头位置未对齐原型「底部页签条两侧」排布,维持现状走马灯两侧垂直居中——issue 清单为材质升级,布局移动未在范围内,且底部排布会牵动 EdgeDropZone 同位问题。
- **工作区事故(2026-08-20):** 实现在主工作区完成后,被并行会话(票 07)开工前的两次 `git stash` 清场卷走(stash@{0}/stash@{1});改经 `.claude/worktrees/ticket-11-chrome-reskin` 隔离恢复提交。注意:`liquid-glass-and-groups/` 的 issue 文件此前从未入库,本票为该目录首个入库文件,票 01–10/12 的 issue 文件仍在主工作区未跟踪态。
- **双轴 review 修复(2026-08-20,落地行 728465e 之后的同分支 commit):** (1) SearchBox focus 反馈原用 `focus-within:bg/border`——`.lens-panel` 是 unlayered CSS 恒胜 Tailwind layered utilities,实际不生效;改 `focus-within:outline-*`(outline 独立属性域)。(2) 箭头 hover 补回暗档 `dark:hover:bg-white/20`,消除统一为 40% 的 scope creep。(3) 确认 LensBox 采样的是 L0 页板合成(Chrome 均渲染于 `main.page-panel` 内,page-panel 的 backdrop-filter 构成 backdrop root)——与原型 Mockup 同构(原型 chrome 亦画在 `plx-page` 之上),非偏离;实机验证时如折射观感弱可与原型页并排核对。
