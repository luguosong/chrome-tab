# 上游取数原语族:fetchRes/fetchText/fetchJson/fetchBuffer 与「防挂起」单点

背景:`fetchText` 注释自述收编条件「自第三处同形起收归共享」(changelog/videoUpdates/modelTracking 后又收 news 15 源与「GitHub 趋势」),而 weather(`getJson`)/dida(`postJson`)/aihot(`createCachedSource`)三处裸 fetch **无 AbortSignal.timeout**,正是同形的第四五六处;servermon 另自造了带超时的第四个 wrapper(`prodServerMonDeps`)。「超时防挂起」(ADR-0017)是原语的私有属性而非全部上游取数的公共属性——weather 域有线上事故前科(上游迟滞致 500,若叠加无超时则请求挂死)。

**决策:原语族单点「超时防挂起 + 非 2xx 抛带 status/body 的错」,四域收编;域差异留域内;接线 A 代化明确不做。**

1. **原语族**(common.ts):`fetchRes` 是 Response 底形态(超时 + 非 2xx 抛,不变量唯一实现点),`fetchText`/`fetchJson`/`fetchBuffer` 为其一行形态衍生。签名收 `string | URL`(对齐原生 fetch,weather/dida/aihot 均传 `new URL(...)`)。
2. **四域收编**:weather `getJson`、aihot 取数闭包、servermon `prodServerMonDeps` 直接换 `fetchJson`(错误消息随之统一为 `GET url → HTTP status` 形态);dida `postJson` **保留壳**——`ConflictError(502)` 透上游状态(dida.test 断言该消息)与「content-type 非 JSON → undefined」(空体写响应)是域语义,内核换 `fetchRes` 并 catch 带 `status` 的错转 502(TimeoutError 等无 status 者原样上抛)。超时统一 `FETCH_TIMEOUT`(10s;servermon 保持自有的 5s——快照多机并抢、快失败是有意的)。
3. **不收(防重提)**:①`ai/agent` 的 LLM 调用——read 超时(READ_TIMEOUT_MS)与匿名抓取的 10s 语义不同族,且已有 `AgentDeps` 注入 seam;②**接线 A 代化不做**——「service 上提到 index.ts + 条件挂载」对按需取数域是形式主义:三域无 scheduler 消费者(A 代上提的真实动因),恒挂载是**有意契约**(weather 未配置 500 §7、dida 400、aihot 恒可用),`apiHost`/`baseUrl`/`cfg` 本就是注入点(stub 上游直指即完成替换)。「轮询域(service 上提 + 假 fetch 注入)vs 按需域(routes 闭包 + stub 上游)」是各有理的两族,不是先进/落后两代。

**代价与取舍。** 换来:「防挂起」成为新上游域的默认属性(裸 fetch 在 backend/src 仅剩 common.ts 原语内部与 ai/agent 两处,grep 可断言);超时与抛错语义的变化点全 backend 单点。付出:原语族 4 个导出(形态正交、各一行);dida 的错误转换多一层 catch;weather/aihot 的错误文案从域措辞变为原语统一形态(降级路径只记日志不断言文本,无测试波及)。
