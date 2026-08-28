# 限流闸门进 callModel 原语:「调一次模型」含时序纪律,由构造保证

背景:ADR-0032 把 `callModel` 立为「调一个候选模型一次」的内层原语,ADR-0034 把译文表存储收进 `makeTranslationStore`——但 5rpm 节流闸门(2026-08-27 free 渠道限额告示的产物)`gateRequest` 的唯一调用点停在 `makeBatchTranslator` 内部:news/trending 批量链过闸,changelog 的单段候选链(`prodChangelogDeps.translate`)直调 `callModel` **绕闸裸奔**——translate.ts 的注释宣称「changelog/news/trending 三域共享同一闸门」,文档与行为不符。网关限额再调整时,改 `LLM_MIN_REQUEST_INTERVAL_MS` 的人会以为全库生效;用户触发的 `translateVersions` 与任意轮询重叠时段,段间零间隔连发是真实的 429 事故面。

**决策:闸门挪进 `callModel` 开头;`gateRequest()` 无参化(内部每次读 `process.env.LLM_MIN_REQUEST_INTERVAL_MS`,默认 12_000ms);不再导出。**

1. **不变量进原语,构造即保证**:「调网关必过闸」从「调用方记得过闸」(注释知识)变原语内部事实——任何走 `callModel` 的消费者(changelog 单段链 / news / trending 批量链,及未来新链)自动共享同一进程级闸门。这是对 ADR-0032 接口划分的修正:限流是「调一次模型」的内层时序纪律,不是域差异,不属于该 ADR「失败策略/onPhase/日志留外层」的裁定范围。
2. **无参化换取更小 interface**:间隔值由闸门自读 env(与测试的 beforeEach 注入模式天然一致),`makeBatchTranslator` 删掉 `minInterval` 与显式调用——调用方少知道一件事。代价:`translate.test.ts` 的闸门用例从构造参数 env 改为 `process.env` 注入;`changelog.test.ts` 两个真链路 describe(候选链/分段)加 beforeEach 注入 1ms(否则换候选/换段用例真等 12s)。
3. **验收 = 三域测试全绿 + 新增 changelog 过闸用例**:注入 80ms,断言换候选的连续两次 fetch 时刻差 ≥50ms(闸门间隔按放行时刻计,fetch 时刻差带 ±几 ms 微任务噪声,80 全额会偶发 79;无闸裸奔实测 0~3ms,50 居中判别)——「三域共享」从注释宣称变测试保证。既有用例除注入方式外零改动,changelog.ts 候选链本体零改动(接缝挪对位置的回报)。

**代价与取舍。** 换来:限额纪律修正一处、真全库生效;changelog 段间连发消除(用户触发补译回到限额内的诚实速率,与 news/trending 同节奏;「排队中」语义在 CONTEXT.md「译制阶段」词条本就存在)。付出:changelog 补译从段间零间隔变为 ≥12s/段——回到 free 渠道 5rpm 的真实速率约束,非回归;测试对 env 注入多一处依赖。**后续**:`ai/agent.ts` 是网关第四消费者,现裸 fetch(无闸、无 status/body 错误形状、无候选链)——骨架阶段无端点零消费者暂无后果,该域上线 HTTP 端点前须对齐 `callModel`(或至少对齐错误形状),否则本闸门的保护伞盖不到它。
