# 译文表存储机制单点:哈希译文仓 makeTranslationStore——原文键、ensure 编排归一

背景:ADR-0032 把译制机制的地基(网关五件套 + callModel)归位 translate.ts,但三张「译文表」(changelog 版本块/news 标题/trending 描述,ADR-0017/0029/0030)的**存储机制**仍是三域各一份同构拷贝:loadTranslations ×3(12–13 行)、批量补译骨架 ×3(去重→滤缺→批译→null 过滤→onConflict doNothing,27–29 行)、读侧 join ×3,合计 ~120 行机械重复。同一个 SQLite 参数上限问题三个答案(news 500/批,其余「实测 361/25 条不分批」各自注释论证);「孤儿译文不清理」口径是三处注释的口头禅;哈希派生(sha256)漏进每个调用方——三域 join 共 11 处 `zh.get(sha256(x))` 形调用。另 `TRANSLATED_SOURCES` 是裸 `ReadonlySet<string>`,拼错源 id 编译通过且静默永不翻译。ADR-0032 末笔已将「译文表三份读写的收敛与 TRANSLATED_SOURCES 清单进编译器视野」记为架构评审候选 5 缓办——本 ADR 即其兑现。

**决策:translate.ts 再深一层——`makeTranslationStore(db, table)` 单点 `{load, save, ensure}`,键 = 原文;域退为薄 adapter;严格零行为变化。**

1. **键 = 原文,哈希是 implementation**:load 返回 `Map<原文, 译文>`,sha256 派生完全内化(store 内部维护 哈希→原文 反查);三域 join 从 `zh.get(sha256(x))` 变 `zh.get(x)`,news 的 titleHash 别名(sha256 再导出)消亡。调用方少知一件事——interface 更深。
2. **ensure 吃下批量补译骨架**:去重→load→滤缺→批译→null 丢弃→onConflict 入库。域只剩真差异:收集 texts、域过滤一行(news 剔 `\n` 标题、trending 汉字启发式)、translator 实例(system prompt 在域)。**changelog 只消费 load/save**——单块按需译 + onPhase 阶段上报是 ADR-0032 裁定的真域差异,编排留域。
3. **错误模式 = 上抛,降级 catch 留域**:带域上下文(源 id/块标题)的「保持原文」warn 是各域的运维 interface,同 ADR-0032「原语不打印日志」裁定延伸到存储件。
4. **表名↔主键列名配对走判别分派而非动态列名**:Kysely 0.29 的 `dynamic.ref` 无 `.as`、联合表名 builder 的 select/where 签名互斥——三支字面量列名(约多 25 行)换来零类型逃逸与编译器背书的配对保证。空/纯空白译文在 save 处丢弃(空哈希行会终身缓存成空白,2026-08-25 事故形态;此前批量路径靠解析器保证、单块路径靠域内守卫,现统一为信任边界单点)。
5. **LOAD_CHUNK=500 单常量**:三域三答案收敛(news 先例;361/25 量级单批不变,行为中性)。三张表原样不动(零迁移、DDL 注释的孤儿口径原地成立);三表不合并——三域 system prompt 不同,同原文在异域 prompt 下译文不同,合并会跨域污染命中。
6. **TRANSLATED_SOURCES 类型化**:`ReadonlySet<NewsSourceId>`(shared 已有该联合),拼错源 id 从「静默不译」变编译错误;db source 列读出按同文件既有惯例 `as NewsSourceId` 收窄(写入时经 VALID_SOURCES 校验)。

**代价与取舍。** 换来:存储/补译纪律(分批、onConflict、空串防线、孤儿口径)修正改一处;第四张译文表免费;三域 11 处哈希调用与 3 份骨架(~120 行)消失;源 id 拼写进编译器视野。付出:判别分派比动态列名多 ~25 行(类型系统实证所迫,注释记因);translate.ts 189→297 行(深度即目的);changelog translateIfMissing 与 store.save 的单块路径多一层调用。**验收 = 零行为变化**(唯一已声明的例外见第 4 条:changelog 单块路径的空串译文从「入库成终身缓存毒行」收紧为「丢弃」,内存快照行为不变,DB 侧是改善性漂移):既有测试一字未改全绿(全量 461→469,新增 8 个 store 用例:原文键命中/501 分批边界/onConflict 幂等/空串丢弃/ensure 滤缺有序/null 不写/零缺译零调用/三表分派支列名配对);tsc 零错。
