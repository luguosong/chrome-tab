# 12 — 详情面板换肤 + 全量收尾回归

Type: task
Status: ready-for-human
Blocked by: 09 — L1 token;06/07/08、10/11 — 跨票回归对象(本票排最后执行)
落地:742dfe8(代码/测试/双轴 review 完成;余 1 项实机手动走查)

**核对结论:** 五浮层外壳在票 09 升参 `.glass-panel` 时已自动生效 L1(核对其余各处无残留 `bg-*` 覆盖玻璃底),本票实改:① 五浮层 + LocationPicker 城市下拉(「剩余浮层」之一)补挂 `glass-panel-readable` 兜底层(全为文本密集面板);② 清远古残留(1d953c3 旧 token 时代用法):SettingsDrawer 关闭按钮、BackupRestore 三按钮 `glass-panel` → `bg-white/20`——L1 升参后 `0 8px 32px` 大阴影挂 26-28px 小按钮过重,且按钮叠 L1 面板不在方向 C 的 glass-on-glass 放行范围,与四处既有关闭按钮配方对齐;③ GroupOverlay 遮罩 `/45→/50` 与其余六处浮层遮罩统一。**分组弹层(08)核对通过零改动:** 外壳本挂 `.glass-panel` 已随 09 升参自动到 L1 新 token;组内 squircle 是图标层 soft 档、正确分层;**不垫 readable**(图标网格是视觉主体,iOS 文件夹式纯玻璃)。

**Review 修订(双轴对抗校验后):** ① Spec 轴疑点 `AddDrawer` 顶栏 `bg-[inherit]` 判非残留——`inherit` 正为跟随面板底色而设,aside 挂 readable 后顶栏自动继承更实的底、sticky 遮盖变好,不改;② 按钮无暗色分支判非偏离——参数表 white·20/black·20 是**面板兜底层**参数,内部控件按钮沿用全仓既有 `bg-white/20` 配方(永久深色下即生效值);③ 遮罩统一判入视觉轴回归范围(spec「材质一致性」延伸),非 scope creep。

**后续票线索(review 记录,非本票范围):** 白药丸按钮配方(`rounded-full bg-white/20 hover:bg-white/30|40`)现散布 7 处且 hover 已分叉两值,可收一个 `.glass-btn` token;GroupOverlay 改名行 / Icon.tsx 编辑·尺寸菜单 / LoginPage 登录卡仍是裸 `glass-panel` 无 readable(「文本密集面板垫底」若自此成为准,这些待收);`ChangelogTile.tsx` 全仓无引用(被 ChangelogDrawer 取代的死代码,提及不动);Carousel 跨页热区提示 `opacity<1` 期间 backdrop-filter 失效(票 09 已知 Chromium 坑,视觉可接受,实机走查时留意)。

**回归走查记录(代码/测试层,实机项见下方清单):**
- 数据轴:groupReducer 30 + iconCapacity 16 + backup 8(v1/v2)+ iconReducer 19 全绿;后端 IconGroupWriteApi / ConfigReplace 等 98 全绿。建组/弹层/组内排序/拖出/解散/容量 409/备份导入导出的状态转移均有测试锚。
- 视觉轴:globals.css 三档类(L0/L1/L2/soft)参数与 ADR-0012 定稿逐项一致,明暗双值齐全,`@supports not (backdrop-filter: url(#f))` 回落 L1 与 LensBox 的 CSS.supports 同表达式;分层核对——L0 页板 2 处、L1 浮层 + readable、soft 图标层/组内 squircle、L2 lens(SearchBox/PageTabs/胶囊/箭头)。
- 交互轴:carouselNav 11(走马灯环绕)+ pageTransition 7(跨页拖拽)全绿;GroupOverlay 合成 pointercancel 方案(ESC 回滚)、portal 子树 / backdrop pointer-events:none / 拖拽三段式约束注释完整在位;各浮层 Esc/遮罩关闭监听在位。
- 构建:前端 tsc + vite build 通过(344KB gz 108KB);后端 mvn test BUILD SUCCESS。

- [x] 五个浮层 L1 换肤 + 可读性兜底层(含 LocationPicker 下拉)
- [x] 分组弹层材质统一到 L1 token(核对通过,08 已挂 + 09 升参自动生效,零改动)
- [x] 数据轴回归:分组全流程 + 备份 v1/v2 导入导出(测试层全绿;实机项转手动清单)
- [x] 视觉轴回归:三档材质一致性、明/暗壁纸、`@supports` 回落(CSS 层核对;壁纸实机项转手动清单)
- [x] 交互轴回归:编辑模式手势、走马灯、跨页拖拽、ESC 回滚(测试层全绿;手感实机项转手动清单)
- [ ] 验证:全功能手动走查清单留痕 — **待手动验证**

**手动走查清单(逐项打勾):**

数据轴:
- [ ] 建组(编辑模式拖 A 悬停 B dwell→松手)/ 加入已有组 / 组拖到图标上不合并
- [ ] 弹层:打开/改名(清空回落「新建分组」)/滚轮翻页/页点指示
- [ ] 组内排序 + 拖出落页 / 解散洒回 + 容量 409 气泡提示
- [ ] 备份导出 → 导入(替换)→ 导入(合并);v1 旧格式文件导入一次
- [ ] 新增抽屉连续添加 + 单例置灰 + 容量 409 提示文案

视觉轴:
- [ ] 五浮层 + 城市下拉:L1 玻璃 + 文本可读性(明/暗壁纸各看一遍)
- [ ] 分组弹层纯玻璃(无 readable)与五浮层有 readable 的层级差异观感
- [ ] 三档一致性:搜索框/页签条/胶囊/翻页箭头(L2 折射)vs 浮层(L1)vs 图标(soft)
- [ ] `@supports` 回落:DevTools Rendering 面板或 Firefox 打开一次,chrome 降级 L1 无折射
- [ ] Carousel 跨页热区提示淡入时玻璃是否异常(已知 opacity<1 坑,确认可接受)

交互轴:
- [ ] 编辑模式:右键/长按进入、抖动、拖拽排序、× 删除、尺寸菜单、✎ 编辑
- [ ] 走马灯:滚轮/箭头/页签三种翻页 + 首尾环绕
- [ ] 跨页拖拽:拖到页边缘热区翻页落位
- [ ] ESC:拖拽中 ESC 回滚且弹层保持开;非拖拽 ESC 关浮层;改名中 ESC 只取消改名

**What to build:** 剩余浮层核对 **L1 regular 玻璃**换肤:`StockModal` / `WeatherModal` / `ChangelogDrawer` / `AddDrawer` / `SettingsDrawer`(含内嵌 `BackupRestore`)——09 升参 `.glass-panel` 后这些浮层多数自动生效,本票实际做的是:逐个核对无残留旧参数/自定义样式、按参数表垫可读性兜底层(亮 `white/20` / 暗 `black/20`)。分组弹层(08)材质统一到 L1 新 token。最后做**跨票回归**:06–11 全功能走查——数据轴(建组/弹层/组内排序/拖出/解散/容量 409/备份导入导出 v1 与 v2)+ 视觉轴(三档材质一致性、明暗壁纸、L2 回落路径)+ 交互轴(编辑模式全部手势、走马灯、跨页拖拽)。

遵循 ADR-0012。

**工具:** 实现时使用 ui-ux-pro-max 插件——动工前 Skill 调用 `ui-ux-pro-max:ui-ux-pro-max`(UI/UX 设计智能);涉及 Tailwind 样式细节可配 `ui-ux-pro-max:ui-styling`。
