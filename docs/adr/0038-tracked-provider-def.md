# 跟踪厂家 provider 定义归一:一厂家一份 ProviderDef,取数骨架单点 runPoll

背景:「一个跟踪厂家 = 基线 + 解析器 + 匹配器 + 信源 URL + 线索策略」这个概念上的 adapter 一直存在,却没有 interface——七家各长各样,`modelTracking.ts` 逐家特判:①**匹配器签名三态**(智谱/Anthropic/Kimi 返回单值|null,xAI/DeepSeek 返回数组,OpenAI/通义吃整批条目数组),七个 poll 闭包逐家适配;②**解析器住址双约定**(DeepSeek/通义随基线文件走——issues/07 五家并行接入时防 modelTracking.ts 争用热点的临时手段,注释自陈「从未收拢」;其余五家挤在 modelTracking.ts),测试被迫双头 import;③**接线五点**(通义接入 d151833 实证 11 文件、modelTracking.ts 内散布 4 区域);④**横切改动 7 倍税已实缴**——线索机制(7bed3b2)落地时 `modelKey` 回退链在六个闭包里各写一遍、形态各异。而每个闭包 ~15 行骨架(零条目判改版/hits-clues 收集/循环)逐字同构 ×7,真正逐家不同的(匹配 + 线索构造)只有 ~10 行。

**决策:`providers/<id>.ts` 一厂家一份 `ProviderDef`;取数骨架全部沉入 `runPoll`;ADR-0025 口径零触碰(基线即配置、人工核验、线索机制、双条件归属、不开放任意厂家)。**

1. **`ProviderDef<E>` 单条目分派**:`{ id, label, urls, parse, matchEntry(e) → { hits, clue | null } }`。runPoll 持有全部骨架:逐页 fetch → `parse` 零条目判上游改版 → 逐条 `matchEntry` 收集 → ingest/ingestClues → 标新鲜。家族式条目(xAI「Grok 4.20 and … Multi-agent」)由 hits 数组承载;`clue: null` 表达「不落线索」(月暗文章流、无 `Model:` 字段的 OpenAI 平台条目)。
2. **一厂家一文件** `backend/src/providers/<id>.ts`:条目类型 + 解析器 + 匹配器 + URL + def 组装同居。**baseline 大文件不拆不动**——七家 `xxxBaseline.ts` 只被 import(与 provider 文件之间是 type-only `BaselineModel` 循环,esbuild/tsc 擦除后无运行时回边)。URL 常量的住址判据 = **数据侧拼串共用**:`DEEPSEEK_UPDATES_URL`/`QWEN_RELEASES_URL` 被基线事件的 `sourceUrl` 拼串引用,留在 baseline 文件由 provider import(同 `OPENAI_CHANGELOG_PAGE_URL` 先例);其余四家 URL 随 provider 文件。
3. **moonshot 双页 = `urls` 多项的通用语义**:循环逐页独立取数(单页失败不阻另页入库)、失败先吞后聚、循环后统一补压终态(失败优先)再上抛首个错误。单页家 `urls: [URL]` 自然退化。**已声明漂移**:单页家失败路径比旧闭包多一次幂等 `markSource(false)`(pollOne 内已标,聚合再补压一次)——对外 throw 同一错误,DB 侧一次幂等 update,记档接受(ADR-0034「改善性漂移记档」先例)。
4. **`pollXxx` 保留为一行薄壳**(委托 `runPoll(XXX_DEF)`):按名单家轮是运维 interface(线上单家排障/手动补一轮),测试主力入口也在此;**`pollQuietly` 改遍历 `PROVIDERS`**——「新增厂家忘了挂 cron」从人记变结构保证,厂家名日志经 `def.label` 保持原格式。
5. **`Record<ModelProviderId, ProviderDef<unknown>>` = 编译期完备性**:新厂家票在 shared 扩了枚举而漏挂注册表,编译即错,不写完备性测试(类型即测试)。泛型擦除靠 `matchEntry` 方法语法(TS 方法双变)使 `ProviderDef<具体条目>` 可存入注册表,`parse` 函数属性返回协变天然成立。
6. **评测源(`pollEvaluations`)不纳入**:六路取数、无 baseline/匹配器/线索形状,硬套会把 ProviderDef 撑宽成 shallow(为 1/8 成员加可选字段群)——「one adapter = 假想 seam」的反向应用,保持独立方法。
7. **转发不留**:`modelTracking.ts` 对七家 baseline 的 re-export 与对解析器的隐式转出口全删,测试 import 改道为单约定——baseline 从 `xxxBaseline.ts`,解析器/匹配器/URL 从 `providers/<id>.ts`(「学一个符号看两处」的税除根,拒绝 ADR-0034 之外的兼容转发)。

**代价与取舍。** 换来:横切关注点落 def 一层——下一个线索机制式改动从 7 处变 1 处;解析器住址从双约定变单约定;新增厂家 = shared 枚举 + 基线文件 + provider 文件 + Record 一行(编译器把关漏挂);`modelTracking.ts` 1153→642 行,恢复纯 Service/骨架/路由身份。付出:`matchOpenAIEvents([e])` 逐条喂依赖其无跨条目状态(代码结构可证,claimed Set 是条目内局部);「一个厂家」在文件系统上有两个家(baseline 数据文件 + provider 文件),靠命名对齐(`xxxBaseline.ts` ↔ `providers/<id>.ts`,id 取自 ModelProviderId:moonshot 对应 kimi 前缀符号、alibaba 对应 qwen 前缀符号——id 是「跟踪厂家」的领域名,符号前缀是上游产品名,两套各自稳定)。**验收 = 既有测试除 import 路径外零改动全绿**(26 文件 485 用例)+ tsc 零错;过程中一次红灯正是护栏工作:openai 旧闭包的「部分认领条目不落线索」守卫曾被误扩成「不分派」而丢事件,`gpt-5.6-sol 部分认领条目以 updated 入库`用例当场抓住——「interface 即测试面」的实证,修法是回到与其他六家同构的形状(`hits.length > 0 → hits,否则 clue`)。
