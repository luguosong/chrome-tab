# 12 — 详情面板换肤 + 全量收尾回归

Type: task
Status: ready-for-agent
Blocked by: 09 — L1 token;06/07/08、10/11 — 跨票回归对象(本票排最后执行)

**What to build:** 剩余浮层核对 **L1 regular 玻璃**换肤:`StockModal` / `WeatherModal` / `ChangelogDrawer` / `AddDrawer` / `SettingsDrawer`(含内嵌 `BackupRestore`)——09 升参 `.glass-panel` 后这些浮层多数自动生效,本票实际做的是:逐个核对无残留旧参数/自定义样式、按参数表垫可读性兜底层(亮 `white/20` / 暗 `black/20`)。分组弹层(08)材质统一到 L1 新 token。最后做**跨票回归**:06–11 全功能走查——数据轴(建组/弹层/组内排序/拖出/解散/容量 409/备份导入导出 v1 与 v2)+ 视觉轴(三档材质一致性、明暗壁纸、L2 回落路径)+ 交互轴(编辑模式全部手势、走马灯、跨页拖拽)。

遵循 ADR-0012。

**工具:** 实现时使用 ui-ux-pro-max 插件——动工前 Skill 调用 `ui-ux-pro-max:ui-ux-pro-max`(UI/UX 设计智能);涉及 Tailwind 样式细节可配 `ui-ux-pro-max:ui-styling`。

- [ ] 五个浮层 L1 换肤 + 可读性兜底层
- [ ] 分组弹层材质统一到 L1 token
- [ ] 数据轴回归:分组全流程 + 备份 v1/v2 导入导出
- [ ] 视觉轴回归:三档材质一致性、明/暗壁纸、`@supports` 回落
- [ ] 交互轴回归:编辑模式手势、走马灯、跨页拖拽、ESC 回滚
- [ ] 验证:全功能手动走查清单留痕(逐项打勾记录在本票)— **待手动验证**
