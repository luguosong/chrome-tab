# script 注入加载器族:loadJsonp/loadVarScript 与注入生命周期单点

背景:前端直连上游(ADR-0004 取向)绕 CORS 走 `<script>` 注入通道,四家消费方各持一份逐字同构的注入骨架——`useQuotes`/`useFundamentals`/`useKlines`(架构评审候选 2)与 `useInstrumentSearch`(标的检索 smartbox,评审清点遗漏,grep 补证):createElement → 8s 超时守卫 → settled 旗 → cleanup(摘 script,回调通道另删 `window[cb]`)。超时策略、清理类 bug(回调泄漏/重复落定)任何调整都要改四处,且四份零测试。这是 ADR-0045 后端取数原语族收编在前端的另一半。

**决策:注入生命周期单点 `lib/scriptLoader.ts`,两通道两导出不抹平,可选 AbortSignal 取消,超时 8s 钉常量,grep 契约断言把关。**

1. **两通道两导出**:回调通道 `loadJsonp`(东财 push2/push2his,`cb=` 真回调——cb 名内核生成、先挂 `window` 再注入、用毕即删,调用方以 cb 名拼最终 URL)与 var 通道 `loadVarScript`(腾讯 qt.gtimg/smartbox,注入后 onload 读全局变量、缺失/非串兜底空串)共享私有内核 `inject`(创建 → 8s 超时 → settled 幂等 → 清理:摘 script、删回调、摘 abort 监听)。失败路径(超时/onerror/中止)统一内核,成功路径经 settle 上交各通道;「先挂回调再 appendChild」是结构保证(注入前钩子),不靠调用方自觉。
2. **四家收编**:三个 query hook 的手写加载函数(loadQuotes/loadPush2/loadPush2his)整体消失;`useInstrumentSearch` 改 `AbortController`——cleanup 即 abort,保住「立即摘 script」的竞态收窄语义(就绪未执行的 script 移除后多数浏览器不再执行),超时/失败/中止统一 `.catch` 降级空候选(原行为:无 error 态),序号守卫留域。错误文案统一「script 加载超时/加载失败」——原四套域措辞(「行情超时」「估值超时」…)无 UI 消费者(StockModal 硬编码「行情刷新失败」),纯控制台噪音。
3. **不收(防重提)**:URL/fields 拼接、parse、防抖(调用方组件)、序号守卫(search 域:并发注入共享 v_hint 无完成顺序保证)、queryKey/轮询节奏/staleTime(TanStack 层)一律留调用方;超时 8s 钉模块常量不开参数(四家现状同值,无差异需求);不做并发去重(query 层由 TanStack queryKey 去重,search 由序号守卫)。
4. **契约断言**:`scriptLoader.test.ts` 扫描 frontend/src 非测试源码的 `createElement('script')`,白名单仅 `lib/scriptLoader.ts`——镜像 ADR-0045 补记的 common.test 断言(「grep 可断言」升级为测试把关),下一个域以任何注入形状绕过 loader 都会红。

**代价与取舍。** 换来:注入生命周期不变量(先挂后注入/超时/清理/回调用毕删)全仓单点且首次可直测(stub document + fake timers,不引 jsdom——被测是我们的生命周期逻辑,非浏览器 script 语义);下一个 script 通道消费方零拷贝起步。付出:两导出 + 可选 signal 参数的接口宽度;search 从手写 settled 旗改为 promise + 序号守卫双层,语义等价但读者需跟两层;错误文案从域措辞变统一形态。
