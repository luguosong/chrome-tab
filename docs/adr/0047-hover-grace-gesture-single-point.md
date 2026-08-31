# 悬浮宽限手势单点:hoverGrace 状态机与计时归属

背景:时钟弹层(Clock.tsx)与待办快览卡(TodoIcon.tsx)各持一份逐字同构的 hover-intent 手势——外接矩形联合判定公式、250ms 宽限 + 150ms 重拍计时、全局 mousemove 指针追踪、卸载清理,共 ~70 行算法核双拷(架构评审候选 3)。手势策略是横切产品决策:宽限期、判定盒、门槛任何调整都要改两处;同族 bug 已在快览卡侧三度兑现(切页残留/幽灵弹卡/滚动过期),Clock 侧同族只能人肉同步;两处零测试。

**决策:手势单点 `lib/hoverGrace.ts` 纯状态机(计时进 lib、注入 timer)+ `hooks/useHoverGrace.ts` 接线;首次交互门槛升为可选参数;显隐态泛型兼任会话快照;域收口与浮层挂载形态留宿主。**

1. **计时归属判别轴**:本仓此前唯一的计时先例是拖拽 dwell/notice 计时留在接线 hook(`useDragSession`)——但那是拖拽的**附属反馈**;hover 手象的 250/150 计时是**本体语义**(宽限节奏就是手势本身),进 lib 并注入 timer(默认真 `setTimeout`),表驱动直测计时节奏。ADR-0040 §3「hook 不含可测逻辑」两侧都成立:接线只转发事件,dwell 先例不动,判别轴是「计时是否本体的策略」,不是「计时必须在哪层」。
2. **已知近似(行为差异唯一处)**:Clock 旧实现在 150ms 重拍 tick 里每拍实时重读根盒;统一为「trigger 盒 leave 时刻快照 + 浮层盒 tick 时实时读」(TodoIcon 现状本就如此)后,250–400ms 宽限窗内若窗口 resize,Clock 判定盒略陈旧——概率与后果皆忽略。除此之外零行为变化(250/150 数值、三暗坑收口、portal 形态全不动)。
3. **接口**:`enter(payload)`(门槛在状态机内判,mouseenter 早于 mousemove 派发读到「到达前」累计的时序语义保持)/ `leave(trigger 盒)` / `stay()`(浮层自身被进入)/ `close()`(域收口统一入口:数据变/切页/滚动/点行)/ `dispose()`(卸载);浮层盒经接线 hook 的 `floatingRef` 实时读。计时 250/150 钉状态机内,不开参数(两宿主同值,无差异需求)。
4. **门槛收编**:`PEEK_MOVE_GATE`(10px)从 TodoIcon 私有升为 `moveGatePx?: number` 可选参数(默认 0 不启用)——指针累计位移单点于状态机,宿主不再各自挂全局 mousemove(否则与状态机的指针追踪双监听干同一件事);「防静置幽灵触发」语义对 hover 浮层通用,非快览卡私有。Clock 不启用(常驻大目标,从未需要)。
5. **不收(防重提)**:浮层挂载形态(Clock 子树 absolute vs TodoIcon portal fixed——backdrop-filter/transform 钳 fixed 后代是宿主侧约束)、快览卡定位纯函数 `peekPos`、三暗坑收口时机(数据变/切页/滚动即收——何时收是域知识)全留宿主;不做 grep 契约断言(手势无 scriptLoader 式唯一符号可扫)。

**代价与取舍。** 换来:计时与几何判定首次可表驱动直测(8 用例:门槛/宽限节奏/几何续期/stay/close 幂等/叠 leave/dispose);宽限策略与门槛的调整单点;下一个 hover 浮层宿主零拷贝起步(两宿主手势段各缩至 4–8 行接线,净删 77 行)。付出:状态机 + hook 两文件的接口宽度;Clock 的 `enter(undefined)` 零负载形态略生硬(T=undefined 时 TS 要求显式传参);显隐态泛型兼任会话快照,快照字段约定(如快览卡的 `rowRect`)由宿主自持。
