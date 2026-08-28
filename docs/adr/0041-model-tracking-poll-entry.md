# 模型追踪轮询入口可等待化 pollProvider:单家/全量同 seam,7 个 test-only 薄壳退役

背景:ADR-0038 §4 把「按名单家轮」定为运维 interface,7 个 pollXxx 一行薄壳(委托 runPoll(XXX_DEF))随立;但「线上单家排障/手动补一轮」至今生产零调用,唯一消费者是 modelTracking.test.ts(~55 调用点)——测试需要的「确定性等单厂家一轮」是真能力,却由 7 个生产不走的 interface 方法承载(seam 放错层)。同时生产编排 pollQuietly(): void——fire-and-forget 不可等待,「逐家独立 catch、首轮不等待」的真实编排只有注释、无测试锁;测试为绕开时序不得不用「init 后显式七次单轮」补齐(路由用例即此形态)。

**决策:轮询入口归一为 `pollProvider(id?) → Promise`,吸收 pollQuietly 与 7 个薄壳。**

1. **指定 id = 单家一轮,失败直抛**:确定性单轮——测试断言标陈旧的入口(既有 `.rejects.toThrow()` 契约保持),也是未来运维单家补轮的形态;7 个 pollXxx 退役,测试调用点批量迁移。
2. **省缺 = 全量轮,各家独立 catch**:单家失败记日志、标陈旧,不牵连他家(6h 节奏即天然重试的口径不变);评测轮与厂家轮并行、独立(issues/08 同口径);全轮落定后 resolve、**不抛**——cron/init 的 fire-and-forget(`void`)与测试的 await 同一行为,原 pollQuietly 语义零变化。
3. **init 首轮不等待保持**:`void this.pollProvider()`;可等待化后「init 后七源就位」在测试里从「显式七次单轮」变一行全量 await(时序确定性的税消失)。
4. **编排首获测试锁**:一败六成构造(智谱空页按改版失败、其余默认页正常)断言「整轮不抛 + 失败家标陈旧 + 成功家新鲜」。

修订 ADR-0038 §4:「pollXxx 保留为薄壳:运维 interface,测试主力入口也在此」——骨架决策(ProviderDef / runPoll / Record 完备性)不变,该子句的「运维 + 测试双职责压壳」实测摩擦(生产 0 调用点)以本 ADR 演进:运维与测试共用 pollProvider 单入口,薄壳不复立。

**代价与取舍。** 换来:interface 8 方法 → 1,深 module 吸收等待语义;测试与生产同 seam(侧门消失);编排(独立 catch)从注释变测试锁;新厂家接入不加第 8 个壳。付出:单家/全量的 reject 语义不同(单家直抛、全量聚合日志不抛)——按调用方分:想知道结果的走单家,尽力而为的走全量,两者在调用点即可读出。deletion test:删 7 薄壳与 pollQuietly 后 tsc 零错、27 文件 489 用例全绿(生产零破坏)。
