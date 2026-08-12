# 05 — 编辑模式重构:图标角标(删除 + 尺寸切换)+ 剩余格数

**What to build:** 重构编辑模式以适配 Icon 模型。右键进入/退出编辑模式(沿用现有 `EditModeContext` 的 toggle 语义)。进入编辑模式后,图标右上角显示角标:删除按钮(×,调 `DELETE /api/icons/{id}`)与尺寸切换菜单(small / medium / large 三档,调 `PATCH /api/icons/{id}`)。页面角标实时显示剩余格数。延续现有导航磁贴的抖动(jiggle)与交互惯性,使编排操作直观。

遵循 `CONTEXT.md`(编辑模式、尺寸、页面容量)。

**Blocked by:** 04 — 后端写操作 API(04)(删除/改尺寸需要 PATCH/DELETE 端点)

**Status:** done

- [x] `EditModeContext` 适配 Icon 模型(右键 toggle,顶部"编辑模式 · 右键退出"提示条) — 既有(02/04 已落)
- [x] 编辑模式下图标 jiggle 动画(沿用现有 `editing-jiggle` CSS)
- [x] 图标右上角删除按钮 ×,点击调 `DELETE /api/icons/{id}`,react-query 失效后即时移除
- [x] 图标角标尺寸切换菜单:small/medium/large 三档,点击调 `PATCH /api/icons/{id}` 改 size;仅展示该类型支持的尺寸(从注册表 `sizesFor(type)` 取)
- [x] 页面角标:编辑模式下显示"剩 N 格",基于 `capacityFor(视口) - cellsUsed(icons)` 计算 — 见下方实现决策
- [x] 非编辑模式下点击图标触发其默认行为(看详情/跳转),角标不出现 — 既有(02 已落)
- [x] Vitest 纯函数测试:`capacity.ts` 的 `cellsUsed` / `capacityFor` / `canFit`(对齐现有 `lib/*.test.ts` 先例) — 14 测,落在既有 `lib/iconCapacity.ts`
- [x] 删除/改尺寸后乐观更新 + 失败回滚(react-query `onMutate` 模式) — `useDeleteIcon` / `useUpdateIconSize`

## 实现决策(2026-08-11)

- **页面容量角标取 `DEFAULT_PAGE_CAPACITY`(24,6×4)而非按视口估算行数**:后端 `requireCapacity` 以 24 为最终防线,角标与服务端一致才不会出现"角标显示剩 3 格但服务端实际放行 8 格"的误导。纯函数 `capacityFor(cols, rows)` 仍按任意行列单测覆盖;若后续要切视口行数,只改角标处的容量来源即可。
- **尺寸切换为下拉菜单**(ticket 措辞「菜单」),仅列 `sizesFor(type)`;单尺寸类型(changelog 仅 large)不渲染尺寸按钮,只留删除 ×。
- **`CELLS_PER_SIZE` 由 `iconLayout.SIZE_CELLS` 派生**(cols×rows),网格维度单一事实源。
- 落地文件:`lib/iconCapacity.ts`(+函数/测试)、`lib/iconCapacity.test.ts`(新)、`components/Icon.tsx`(EditActions + jiggle)、`components/IconGrid.tsx`(角标)、`api/config.ts`(`useDeleteIcon`/`useUpdateIconSize` + `toWireSize`)。
