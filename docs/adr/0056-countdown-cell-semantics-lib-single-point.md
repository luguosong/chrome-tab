# 倒计时日历格语义单点 lib:三源合并与逐格决策下移,interface 即测试面

背景:ADR-0054 日历化 + 三轮视觉精修(b393beb 配色定案、9376e9f 文字不变色、6141d46 农历副行)之后,「一格长什么样」的全部语义决策住在 CountdownModal 组件的未测层——三源合并(ics 休/班 + 内置节日 + 重要日子,「同日撞期三源共存」由语句顺序隐式实现)、底色四层优先级链(重要日子琥珀 > 休深绿 > 班红 > 周末淡绿)、副行优先级(节日名 > 节气/农历日)、休/班角标、表单校验;而测试全在 lib/countdown.ts 的原子数据层(buildMonthGrid/holidaysInMonth/lunarDayText)。被测的与承载决策的是两层:色语义恰是用户裁决最密集的区域,回归零护栏(2026-09-04 架构评审候选 1,grill 定案)。

**决策:三导出收进 `lib/countdown.ts`,组件只做渲染映射;`CellMark`/`ImportantDateDraft` 类型随迁。**

1. **`buildCellMarks(icsDays, year, months, importantDates) → Map<iso, CellMark>`**:三源合并单点。ics 全量平铺直接入 map,内置节日与重要日子按 months 铺开当月实例化(月视图 `[当月]`、年视图 0..11——months 参数是视图决策,`ALL_MONTHS` 常量归组件)。同格撞期三字段共存、互不覆盖——谁赢由 cellModel 优先级定,合并不预判。
2. **`cellModel(cell, mark) → CellView{bg, subline, corner, clickable}`**:逐格决策单点(对齐 klineChartModel 先例:lib 出模型、组件映射)。底色/副行/角标/可点性四件套即 2026-09-03 用户三轮定案的载体,回归护栏打在此处。**subline 惰性 getter**:年壁迷你点只取 bg,12 卡 × 42 点不推农历(504 次 Lunar.fromDate 留给月历大格读时才算)。
3. **`draftToImportantDate(draft) → {ok:true, item} | {ok:false, error}`**:表单校验与成形下移(错误文案与表单直显一致;annual 年份占位 2000、农历月日不查历表的既有口径原样随迁)。组件 `type Draft = ImportantDateDraft` import 别名,既有引用零改动。
4. **明确不收**(grill 定案):
   - **dir 清零规则**(六处 `setDir(0)`)——注释单点、行为正确,deletion test 不通过(收成 reducer 是为对称而对称);它属导航态不属格语义,不在本接缝。
   - **today ring 与 hover/active**——交互态/UI 锚点(输入是 `now` 不是格语义数据源),留渲染层。
   - **`dayKey`**——原 marks useMemo deps 的隐性依赖,函数体从未引用(eslint-disable 压的就是它),随迁移删除;todayIso(依赖 now)自然承担跨零点翻新。
5. **验收 = 零行为变化**:前后端 tsc 零错 + 全量测试绿 + 新增语义用例(三源共存/月范围/底色四层/副行角标可点/表单校验与成形共 6 例,含 2026 重阳 = 10-18 农历换算锚点)。无截图比对——色值字符串原样搬,比对必全等。

**代价与取舍。** 换来:色语义与撞期优先级首获直测;「格子为什么是这个颜色」从跨三处拼(lib 三份数据 → 合并 → 优先级 → 渲染再排)变一处读;月历大格与年壁迷你点同 interface 消费,色语同源由结构保证。付出:CellView 是新 interface(四件套形状定案后改起来多一层转发);lib 导出面从 12 符号增到 18(含随迁的 2 类型 + 新增 CellView;三消费方——Modal/图标块/时钟弹层——各取子集,接口仍窄于实现)。
