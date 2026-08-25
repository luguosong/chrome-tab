# 01: 倒计时首版——节假日内置推算 + 重要日子配置 + 时钟弹层展示

**What to build:** 时钟 hover 弹层新增「倒计时」分区:内置 21 项中外节假日自动推算 + 用户配置「重要日子」(名称/历法/重复),≤30 天窗口内按剩余天数升序混排(今天/明天/N 天);编辑走弹层尾部入口的小 Modal;重要日子寄放布局设置(ADR-0026)。

**Blocked by:** None (can start immediately).

**Status:** resolved

- [x] shared 契约:`ImportantDate` 类型 + `LayoutSettings.importantDates` 字段。
- [x] 前端 `lib/countdown.ts`:节假日推算(农历换算/清明节气/除夕=春节-1/浮动公式/复活节 Meeus)+ 重要日子 nextOccurrence(annual 滚年/once 过期剔除)+ 30 天窗口过滤与升序;vitest 对拍真实历表。
- [x] 后端:`layout_settings` 加 `important_dates` 列(DDL + ALTER 补列 + Kysely 类型)、`layout.ts` 白名单校验(条数/字段)、readLayout/updateLayout wire 读写;后端测试。
- [x] 前端接线:`layoutSettings.ts` 默认值 + withDefaults;镜像/备份整份 blob 透传新字段,零改动。
- [x] Clock hover 弹层倒计时分区(空窗保留一行「编辑」入口,否则首条无处可加)+ 编辑 Modal(列表 CRUD、历法切换表单、ConfirmButton 删除、useUpdateLayoutSettings 保存)。
  - code-review 补修:Modal 补 Esc 关闭(姊妹 Modal 基线)、标题措辞统一「重要日子」;`optDates` 补月/日越界校验(挡 13-45 类);`countdown.ts` Solar→Date 提取共用;2-29 annual 进位 3-1 与「PUT 缺字段=清空(整份 LWW)」两处取舍以注释标记;CONTEXT 词条与 spec.md 空窗语义同步为「列表隐藏、保留编辑入口」。
- [x] 领域词条已在 CONTEXT.md(「倒计时」「节假日」「重要日子」);ADR-0026 落盘。
- [x] 全量验证:tsc 零错、前后端 vitest 全绿。

## Comments

- **2026-08-25 实现**:前后端全链路落地。前端 `lib/countdown.ts` 纯函数(21 项节假日:农历经 lunar-typescript 换算当年公历、试相邻两个农历年取落在目标公历年者;清明扫 4 月上旬节气;除夕 = 当年春节 -1 天;母亲节/父亲节/感恩节第 n 个星期公式;复活节 Meeus 算法;annual 今年已过滚次年)→ 12 测对拍 2026/2027 真实历表;`Clock.tsx` 弹层最顶部分区(空窗留一行编辑入口,grilling 共识的微调:纯隐藏会让第一条无处可加);`CountdownEditModal`(每动作即时整份 PUT,无草稿暂存;公历 type=date、农历三 number 输入,annual 年份忽略占位 2000;删除 ConfirmButton 二次确认)。后端 `layout_settings` 加 `important_dates` TEXT 列(addMissingColumns 补列,存量 NULL 读侧兜底 [])、`optDates` 白名单校验(≤100 条、逐条 id/name/date/枚举,违例 400)、Widen 映射类型为结构值默认放行 else 分支;ETL 不迁新列(旧库无)、测试期望补 NULL。存储走布局设置寄放(ADR-0026):同步/镜像/备份/和解全链路随 config blob 免费。测试:前端 278/278(含 countdown 12 新增)、后端 323/323;双端 tsc 零错。对拍基准:2026 中秋 9-25(距 8-25 恰 31 天,天然出窗边界)、2026 清明与复活节同日 4-5、2027 除夕 2-5/春节 2-6。
- **2026-08-25 修 bug(时钟弹层移开即收,无法点编辑)**:根因是弹层 mt-2 的 8px 视觉间隙在 DOM 上不属于时钟 group 任何元素——纯 CSS group-hover 下慢速穿越时 :hover 断链、弹层 opacity-0+pointer-events-none,mouseover 穿透使 enter 永不触发(Playwright 探针:指针停 gap 中点 opacity 单点即红;30 步慢速 leave 后无 enter)。初修 250ms hover-intent 宽限不够慢速(全程>宽限即收)。终修:onMouseLeave 250ms 计时 + 到期几何联合判定——指针仍在「根盒∪弹层盒」外接矩形内则 150ms 续期、真正离开才收;不引入常驻命中区,收起态拦截行为与纯 CSS 版零差异。3/30/60 步三档速度 + 真离开收起四用例 Playwright 全绿;无 e2e 基建,一次性驱动脚本验证后已删(仓库惯例),回归防线为时辰轮纯函数测试 + 本次诊断记录。
