# 详情 Modal 查询骨架单点 DetailModal:标头/tab/状态机收拢,决策逻辑抽纯函数

背景:「各域详情 Modal = ModalShell(ADR-0031)+ 同构内层」的内层一直没有 interface,十家各持拷贝且已实际漂移:①错误/重试块 13 份(AiHotModal 单文件 3 份——三 tab 各持查询态);②下划线 tab 条 6 份,「不可加 -mb-px」陷阱注释在 News/Video 逐字复制,而 AiHot/Todo/Model 三家恰恰仍带 `-mb-px` 踩坑;ServersModal 私有 TabBar 另丢 focus-visible 焦点环;③重试按钮两套方言——6c2bc5b 触达审计曾把 Stock/Weather/Changelog 三家重试钮提至 `min-h-8`(≥32px 触达),之后新增的 News/Video/Model/Trending/AiHot 五家又抄出旧的 `rounded-md px-2 py-0.5 text-xs` 小方言,「触达 ≥32px」裁决对后继 Modal 零自动继承;④「打开即对账」effect 2 份;⑤状态机分支顺序分叉——NewsModal 是「manage 优先于 isError」(勾选管理不依赖 feed 数据,失败仍须可达,注释自证),VideoModal 反之:feed 失败把管理 tab 一并屏蔽,且 Video 的 tab 派生无悬空回落——管理里删掉当前所在分类后落到误导性空态「这个分类还没有视频」。components 层零测试(全部测试在 lib 纯函数层),漂移无护栏。

**决策:内层收进 `components/DetailModal.tsx` 双出口 + `lib/detailModalState.ts` 纯决策函数;八条已声明行为漂移随迁固化。**

1. **`DetailModal`(复合出口)**:收标头(名称 + 可选刷新钮)、tab 条(含悬空回落)、主体查询状态机、打开即对账(`onOpen` 声明式——现仅「新闻」「视频更新」声明,其余八家行为零变化;鲜度与上游压力的取舍归域,结构层不强制)。九家消费(五家有 tab——新闻/视频更新/模型追踪/待办/服务器,四家无 tab——股票/天气/更新日志/趋势,tab 省缺退化;加上单走 QueryPane 的 AI 热点合计十家)。
2. **`QueryPane`(同文件第二出口)**:状态机零件,仅供 per-tab 查询态的「AI 热点」用(三 tab 各一份)——不为 1/10 成员撑宽复合组件的 props(ADR-0038 §6「为少数成员加可选字段群」的反面教训);DetailModal 内部亦消费它,不重复实现。
3. **决策逻辑进 `lib/detailModalState.ts`**:tab 归一(悬空回落)与状态机归约(manage 可达性优先级:不依赖数据查询的 tab 恒可达)为纯函数,测试打这里;JSX 只做渲染映射。不引入组件测试设施(@testing-library + jsdom 为单一 module 引整套依赖,不值)——纯函数测试面即骨架的语义测试面,configMutation 先例。
4. **行为漂移八条(已声明,随迁固化)**:①重试按钮统一 `min-h-8` 大方言(6c2bc5b 触达裁决的延伸);②「视频更新」管理 tab 在 feed 失败时可达(统一 News 语义);③「视频更新」tab 悬空回落「全部」(修 bug);④ServersModal tab 条统一 accent 下划线式并补 focus-visible 焦点环(私有白下划线方言退役,修缺陷;旧 px-1 内缩随方言退役,tab 条 mb-3 与 MachinePane 既有 pt-4 叠出 28px 顶距——间距复合统一为族标准,截图比对按此口径);⑤「-mb-px 陷阱」与「refetch 引用稳定」两段注释收单点;⑥ServersModal 失败空态死路补重试钮(全族唯一无钮的失败路径);⑦「视频更新」管理 tab 三处 input(重命名/分类草稿/博主链接草稿)的 Escape 截断(与 escStack 关窗冲突,核对属实——Esc 就地消化:取消重命名/清草稿,不关 Modal);⑧三家首载 pending 态新增(原无缓存时闪空态文案,如「还没有勾选新闻源」误导)。
5. **两批迁移、批间不排期**:批 1 = 新闻 + 视频更新 + 服务器状态(顺修漂移 ②③④⑥⑦,可独立验收);批 2 = 其余七家(AiHot/Todo/Model/Stock/Weather/Changelog/Trending)纯等价替换——批 1 验收通过即连做批 2,同一轮动工收口,不留长期新旧并存。每批验收 = tsc 零错 + 既有测试全绿 + 副本 db 截图比对(6c2bc5b 先例)。

**代价与取舍。** 换来:横切十域的结构决定一处生效——下次「触达审计」式改动从改 N 家变改一处,后继新 Modal 出生即带裁决;tab 悬空类 bug 从「各 Modal 自查」变结构免疫;components 层首获(纯函数形式的)语义测试面。付出:DetailModal 的 props 是新 interface,批间新旧并存;Todo 的宽度切换、Model 的过滤胶囊等异质主体仍留域——深度止于「标头 + tab + 状态机」,内容永远留域(同 ADR-0039「表字面量留域」取向)。
