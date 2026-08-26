# 01 视口比例布局:响应式根字号 + 全站 rem 化

Type: task
Status: needs-triage

## Task

多显示器、每屏系统缩放不一的场景下,让仪表盘在每块屏上**占屏比一致**(grill 定案 2026-08-26,选「比例不变性」而非「物理尺寸不变性」)。

**现状事实**(grill 已核实):

- 全站无自定义根字号(Tailwind 默认 16px 定死)——直接换 rem 单位是纯改名,行为零变化;产生效果的前提是根字号随视口流动(如 `html { font-size: clamp(...) }` 按 vw)。
- 前端并存三套尺寸体系:Tailwind 工具类 rem、自定义几何 px(`FAV_BASE_PX`、`LAYOUT_LIMITS` 各值)、tileFont 的 cqw。
- px 布局在混合缩放下的实际症状:CSS 像素少的屏(高缩放)上网格几乎满屏、矮视口下 `iconCellGeometry` 钳制压小图标;CSS 像素富裕的屏上仪表盘只占中间一条。

**方向**(已定):响应式根字号 + 自定义几何 px 全面 rem 化;`ICON_SCALE = 1` 常量(ADR-0033)原样兼容,无需回归。

**关键设计点(未定)**:`gridWidth`/`gridGap`/`searchBarWidth`/`clockFont`/`labelSize` 等用户设置的语义重锚定——存量值按 px 存(如 gridWidth 1136),rem 化后要么应用侧换算(px/16 → rem,随根字号同比伸缩),要么滑杆改百分比语义并处理存量迁移。滑杆的 min/max/step 与后端校验范围随语义联动。

**验证门**:动工前先写双视口截图脚本(一次性 playwright,见记忆「布局验证现写一次性截图脚本」)模拟两种有效分辨率(如 1280×720 与 2560×1440),对比观感确认「占比一致 + 无钳制压图标」再全面铺开;铺开后同脚本回归。

## Comments

- 2026-08-26 立项于 grill 会话(/grill-with-docs):图标缩放移除(ADR-0033)同场定案的后续独立工作;先落地移除、本票后做。终态二选一由用户拍板 A(占屏比一致)。
