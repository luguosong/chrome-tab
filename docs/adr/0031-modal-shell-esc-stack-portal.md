# Modal 壳归一:ModalShell + escStack 栈顶派发 + portal 到 body

背景:11 个居中详情 Modal(9 个图标详情 + 重要日子编辑 + 待办二级对话框)各自手拼同一套壳——遮罩点击/Esc keydown/右上角关闭钮/`max-h-[80vh]` 滚动主体/fade-pop 动画,Esc 监听全仓 17 处、Modal 类 12 处逐字重复。代价已三次兑现:tab 行滚动条双修(eee92a5,同 diff 逐字节贴两遍)、雾胶囊滚动条五连点(ce1f399)、焦点环审计 ~15 处逐点补(6c2bc5b)——每次横切视觉迭代都重新审计全部拷贝。另有两处 latent:① 10 个 Modal 挂载于 `.page-panel`(backdrop-filter)内,fixed 后代被钳成锚定 main 而非视口,今天无症状纯属几何巧合;② 「多层同开时 Esc 只关最上层」(待办 Modal 内弹待办详情)仅靠 TodoModal 的 `!detail` 条件特判 + TodoDetail 注释里「由渲染方控制父级忽略」的口头约定维持,无结构保证。

**决策:抽 ModalShell 统一壳收编全部 11 个居中 Modal;Esc 归属走模块级栈只派发栈顶;壳内 createPortal(document.body),并定为后续一切全屏浮层的规范。**

1. **收编范围=居中对话框,不含抽屉/表单/下拉**:右侧抽屉(ControlDrawer)、配置表单面板(Icon EditForm)、下拉选择器(LocationPicker/SymbolPicker)壳结构不同,硬塞进同一 interface 只会把它撑宽成 shallow;它们将来真需要时复用壳内原语,现在不预留。
2. **escStack(lib/escStack.ts)**:挂载入栈、卸载出栈、Esc 只达栈顶。把「谁该响应 Esc」从调用方隐式知识变成结构保证,TodoModal 的 `!detail` 特判随之删除。窗口监听由模块单点持有,空栈派发 no-op;纯逻辑(register/dispatch/unregister)vitest 直测三用例,不为单个组件引入 RTL 设施——一次性迁移的手验成本低于养一套组件测试设施。
3. **interface 刻意留白的两处**:padding 三形态(p-6 ×9 / p-5 重要日子 / Changelog 拆进内部区块)走 `className`,不做默认值——Tailwind 同轴类覆盖不可靠;标题区不进壳(纯文本副行 vs 行内操作按钮异质,slot 抽象救不了)。其余归壳:`width` 四档(sm/lg/2xl/3xl,默认 2xl)、`scroll`(默认 true = max-h+overflow-y-auto+modal-scroll;false 连 max-h 都不加,保 Stock/Changelog/待办详情迁移零视觉变化)、`z`(默认 60,二级对话框 70)。焦点陷阱与 body 滚动锁不做:页面本身固定画布无背景滚动可锁,陷阱无人要求(YAGNI)。
4. **portal 到 body 是本决策的一部分而非附带**:backdrop-filter/transform 钳 fixed 后代是本仓库两次踩实过的坑(GroupOverlay、TodoIcon 快览卡均以 portal 逃逸),10 个 Modal 在钳制域内裸奔属同病未发。Shell 落地把三种逃逸策略(portal / main 兄弟位 / main 内联)收敛为一种;z 序推演无冲突(EditForm 与详情 Modal 编辑模式互斥,GroupOverlay z-40 盖不住 z-60)。

**代价与取舍。** 换来横切修改单点化(下一次滚动条类修复改一处即全仓生效)、嵌套 Esc 从约定变保证、包含块钳制消除、焦点陷阱与滚动锁首次有了落点。付出:重要日子编辑的关闭钮字符 ✕ 统一为 ×(近同形)、Changelog 关闭钮从标题行内移至面板右上角 absolute(数像素位移)、× 在长内容滚动时随面板滚动的既有行为原样保留未修。迁移全程零视觉变化为第一原则,特化全部显式落在调用方 className 里可见。
