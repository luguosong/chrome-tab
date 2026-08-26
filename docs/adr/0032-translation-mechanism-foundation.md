# 译制机制地基归位 translate.ts:网关五件套搬家 + 调模型原语单点化

背景:ADR-0030 把批量译制机制(makeBatchTranslator)从 news 域提升为跨域件 `src/translate.ts`,但机制的**地基**没跟着走——`sha256`/`LLM_BASE_URL`/`modelCandidates`/`extractContent`/`isCandidateExhausted`(含伴随常量 `DEFAULT_LLM_MODELS`)仍住在 changelog.ts,于是 translate.ts、trending.ts、news/translate.ts 三处**反向 import changelog**:改 changelog 的候选链会波及 news/trending 译制,而读 changelog.ts 的人以为在改「更新日志」——seam 切出来了,地基留在域一侧。同时「调一个候选模型一次」的内层纪律(POST 构造、60s 超时、响应解析 try/catch)在 makeBatchTranslator 与 `prodChangelogDeps.translate` 各写一份(~50 行 ×2):2026-08-25 的 LLM 静默事故教训已在两处各打一遍补丁,每次纪律修正付双份。

**决策:五件套搬入 translate.ts(机制层);抽 `callModel` 内层原语单点化;严格零行为变化。**

1. **搬家而非新层**:不建独立 llm.ts——五件套的全部消费者就是译制链(changelog 自身 + news/trending 的哈希派生),为「将来可能有别的 LLM 用途」预设网关模块是单 adapter 的投机 seam,第二用途真出现时再拆不迟。搬后依赖方向归正:changelog → translate(域消费机制),translate 不依赖任何域模块;域特化(`SYSTEM_PROMPT`、`splitSegments`、单块分段协议、onPhase 阶段上报)留在 changelog.ts。
2. **`callModel(model, apiKey, system, user) → { content, resp }`**:候选链的内层原语。返回带 resp 而非裸 `string | null`,因为两处外层在「200 无 content」时的 `lastErr` 都要附原始响应体切片(`resp.slice(0, 200)`)——那是排障信息。成功判定(批量:编号配对数 >0;单块:content ≠ null)、失败策略(批量:warn 吞掉保批次成果;单块:上抛走 Service 降级)、onPhase、日志**全部留外层**——两种译制器的契约差异是真实域需求,共享的只是「调一次模型」这一最小单元。
3. **原语不打印日志**:日志格式(批号/候选序/模型/耗时/走向)是各外层的**运维 interface**(线上排障唯一抓手,两处注释都以 2026-08-25 事故为证),原语返回数据不打印——本次重构的验收之一即两处日志行零 diff。
4. **验收 = 零行为变化**:changelog.test.ts 的候选链/分段 12 个真链路用例(mock `globalThis.fetch` 直测 `prodChangelogDeps().translate` 的换候选序、401 直抛、全链失效、onPhase、分段拼接)实证 changelog 侧行为不变;makeBatchTranslator 侧原先无真链路测试,本次以同款 mock 模式补 3 用例(无 Key 有声拒绝、换候选到成功、401 fatal 带部分成果返回)。全量测试绿。
5. **测试随符号迁**:`extractContent`/`modelCandidates` 的纯函数用例随符号迁入 translate.test.ts;changelog 候选链真链路测试留 changelog.test.ts——测试跟着它所穿过的 interface 走(prodChangelogDeps 是 changelog 的组装),不跟着符号的出生地走。

**代价与取舍。** 换来:LLM 网关纪律(换候选判定、超时、响应解析、哈希派生)修正改一处;changelog.ts 恢复纯域身份(478→423 行);下次网关事故只打一份补丁。付出:无运行时代价(纯归位 + 内层函数提取,调用序列与日志逐字节不变);translate.ts 从 127 行增至 189 行(地基 + 原语 + 批量协议同居一文件,深度即目的)。code-review 随本 ADR 落地三项修正:①changelog 直译路径补空串守卫(`content: ""` 曾会以哈希主键终身缓存、该版本永久空白——批量路径的 `!text` 守卫同款);②`modelCandidates` 纯分隔符(如 `","`)过滤后回默认,候选链恒空曾会让调用方 `throw undefined`;③`ai/agent.ts` 的私有网关地址副本改 import 本文件(它本是网关的第二个消费者,证明「搬家而非新层」的判断只对了一半——但接线后反而是本决策的单点收益)。后续候选:译文表三份读写的收敛与 `TRANSLATED_SOURCES` 清单进编译器视野(架构评审候选 5)仍在域侧,不在本 ADR 范围。
