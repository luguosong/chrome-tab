# 07 — 前端:分组网格交互(合并手势、组图标渲染、加入、解散)

Type: task
Status: ready-for-human
Blocked by: 06 — 后端分组 API(merge / dissolve / move parentId)
落地:52b765c(代码/测试/双轴 review 完成;余 1 项实机手动走查)

**Review 修订(双轴对抗校验后):** ① move-out 经 moveIcon 落地即成(被移项恒清 parentId,镜像后端 move 分支三)+2 测试;② 合并手势同页判定改用**起点页**(onDragOver 跨页乐观只写缓存,悬停跨页目标 merge 必 409 → 禁判);③ dwell 达标后拖离目标不建组(!over 清反馈 + onDragEnd 校验 over);④ dwell 计时提为 useGroupGestureDwell hook(DashboardPage 膨胀让位);⑤ topLevelOf 聚拢「顶层序列」形状;⑥ MoveAction 不携 wire 层 parentId(hook 用 MoveIconVars 交叉类型)。**已知瞬态(预期非 bug):** merge 乐观用负数临时组 id,invalidate 后 React key 更替轻微闪动;move-out 源组变空时组行留待 invalidate 消失;merge 失败窗口内乐观跨页移动靠 onError 回滚 + invalidate 自愈。**stash 注记:**开工前工作区有票 10/11 半成品(破损无法编译,Icon.tsx 引用缺失的 ChangelogIcon),经用户裁决 stash 暂存为两份(图标层+chrome 换肤一份、StockIcon sparkline 一份);票 10/11 开工前 `git stash pop` 两份全恢复(另有配套 untracked 文件 frontend/src/components/ChangelogIcon.tsx 留在工作区未动)。

- [x] `GROUP_DEF` 注册;AddDrawer 不列分组类型;组无尺寸菜单、无 ✎
- [x] 组图标渲染:3×3 前 9 迷你预览 + 名称外置(数据按 parentId 派生)
- [x] 编辑模式合并手势:悬停放大反馈 → merge 调用 → 序列更新(组落 B 位、空位流式补上)
- [x] 悬停到组:同一手势与反馈 → move parentId 入组
- [x] 组拖到图标/组上无合并反馈,普通排序
- [x] 组 × 解散:洒回落位 + 容量 409 提示(组图标上方局部气泡,透传后端 message)
- [x] Vitest:新 `frontend/src/lib/groupReducer.ts`(merge / dissolve / move-out 状态转移)+ `iconCapacity` 扩展(组 1 格、子不计)
- [x] 长按进入编辑模式的辅助入口(550ms、位移>10px 取消、交互控件排除;右键保持为主)
- [ ] 验证:手动走查建组 / 加入 / 解散全流程 — **待手动验证**

**What to build:** 分组的页面网格侧交互(弹层在 08)。`iconTypeRegistry.ts` 加 `GROUP_DEF`(仅 small 档、无 editor;「新增抽屉」不列出分组类型——机制自定:扩 `IconTypeKind` 联合或 `listTypes` 过滤,组只由合并手势诞生),组图标无尺寸菜单、无 ✎。`Icon.tsx` 增 `type='group'` 渲染分支:玻璃容器 + 组内**前 9 个**子图标 3×3 迷你 favicon + 名称外置(与 nav 名称同位;子图标从 `GET /api/config` 扁平列表按 `parentId` 派生)。合并手势(仅编辑模式):拖 A 悬停到 B(同为页面顶层 nav)达阈值 → B 放大反馈 → 松手 `POST /icons/merge`(memberIds=[A, B]);悬停对象是**组** → 同一放大反馈 → 松手 `PATCH /icons/move`(parentId=组 id,入组末尾)。**组被拖到图标/组上不触发合并反馈**,按普通排序落下。编辑模式组图标 × = `POST /icons/{id}/dissolve`,成员按保留 size 洒回本页;409 时提示"容量不足,先移出部分图标"。dwell 阈值 / 悬停命中半径 / 放大倍率自行调参,手感向 iOS 文件夹看齐。数据变更走 react-query mutation + 失效,乐观更新沿用 `DashboardPage` 现有聚合缓存模式。

遵循 `CONTEXT.md`(分组)与 ADR-0001(注册表)、ADR-0003(dnd-kit)、ADR-0011。

**工具:** 实现时使用 ui-ux-pro-max 插件——动工前 Skill 调用 `ui-ux-pro-max:ui-ux-pro-max`(UI/UX 设计智能);涉及 Tailwind 样式细节可配 `ui-ux-pro-max:ui-styling`。
