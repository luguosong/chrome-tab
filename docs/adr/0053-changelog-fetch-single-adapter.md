# 更新日志取数单 adapter:部分成功显式化,调用序协议沉入 implementation

背景:3 天 4 次线上事故(21fb12d releaseTimes 落库 / 81888ea 重试 / c133f4d token 认证 / ee08af5 合成原文源)同一根因——`ChangelogDeps` 的 interface 不表达部分成功。三种错误模式(fetchMarkdown 上抛、translate 吞错保英文、fetchReleaseInfo npm 分支吞错→null / GitHub 分支上抛)只活在注释里,「吞错钉死空表」同一条知识散布 6 处注释;合成源「同周期单次抓取两用」(~26MB releases,ADR-0050 §5②)是 fetchMarkdown→fetchReleaseInfo 之间靠 `composedReleases` 共享态维持的调用序协议,不进签名,测试只能断言涌现行为(calls===1)。后两次修复(重试、落库)都是在为 interface 形状打补丁——补丁有效,但下一个取数分支仍可能再抄一次吞错分支。

**决策:取数收拢为单函数 `fetchUpstream(): { markdown, releaseInfo | null }`;译制候选链归位 translate.ts。**

1. **显式部分成功**:markdown **必在**(拉不到即上抛 → refreshQuietly 5min 重试);releaseInfo **可空**(npm 日期源失败降级 null,调用方 merge 沿用旧值)。错误模式矩阵从注释升格为返回类型——「吞错当成功」在 seam 上无表达位,事故类失去结构载体。
2. **语义矩阵忠实迁移(零语义变化,仅住址迁移)**:changelogUrl 直取 = raw 上抛 + npm 吞错→null;+ githubReleasesApiUrl(matt)= raw 上抛 + GitHub **上抛不吞错**;合成源(codex)= 同一次 releases 拉取两用、上抛;无原文源 = npm times 合成、失败上抛。ADR-0050 §5②「单次抓取两用」的**意图保留、机制退役**——从两函数调用序协议变为 `fetchUpstream` 内局部量。
3. **译制候选链归位,修订 ADR-0032 的域特化住址裁定**(44 行自 changelog.ts prodChangelogDeps 迁 translate.ts `makeBlockTranslator(systemPrompt, logTag, env)`,签名对齐 makeBatchTranslator maker 族)。ADR-0032 §1 曾裁定「域特化(SYSTEM_PROMPT、`splitSegments`、单块分段协议、onPhase 阶段上报)留在 changelog.ts」——本次修订其后三项的住址:候选链/分段/onPhase 编排与 makeBatchTranslator 的候选链循环同构(ADR-0032 自身就是为消这份「纪律修正付双份」而立),maker 化后 2026-08-25 型静默事故补丁只打一份;`splitSegments` 随迁(不迁则 translate.ts↔changelog.ts 双向**值**循环,ADR-0038 只容忍 type-only)。SYSTEM_PROMPT 仍留域内(ADR-0032 裁定不变,trending 传 TRENDING_SYSTEM_PROMPT 同款)。
4. **已声明漂移(记档接受,ADR-0039 先例)**:releaseInfo 取数从「译制后」提前到「译制前」(fetchUpstream 一次返回)——GitHub 主链失败早暴露,省掉注定丢弃的 LLM 调用;译文逐块即存(translations.save),重试时 byRaw 命中跳过,零浪费。无对外可感差异。
5. **明确不做**:index.ts:39 的 translateRecent 分派(`hasChangelogRaw(s) ? 5 : 0`)不动——判别已在 shared 单点、消费仅一处,收编是半分知识加接口面(YAGNI)。

**代价与取舍。** 换来:事故类(假成功落库钉死 6h 窗)从结构上消失;Service interface 从「3 函数 + 序约束 + 注释立法」缩为「2 函数零序约束」;prodChangelogDeps 退成纯取数 adapter;候选链 maker 化后 changelog 域测试面减负(分段/候选链用例随迁 translate.test.ts 直测 maker,被测对象从 prodChangelogDeps().translate 换为 maker 本身——interface 即测试面)。付出:changelog.test.ts 约 30 处 deps stub 两字段合一(机械改形,不留兼容层——ADR-0038「拒绝兼容转发」先例,兼容层是假绿温床);译制日志措辞 `[changelog-translate] {source} 段…` → `[changelog-translate-{source}] 段…`(信息等价,maker 族日志同构)。**验收 = 后端全量 529 用例绿 + tsc 零错**(translate.test 43 含随迁 14;changelog.test 50 减去随迁段)。
