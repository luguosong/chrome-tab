# TTL 缓存 + 宁旧勿空取数原语 cachedOrNull:三域手写变体收拢,TtlCache 刻意共存

背景:「上游读,TTL 内回缓存,失败宁旧勿空」没有 module——aihot(createCachedSource,三端点闭包)、dida(todoBundle 双变量)、trending(Service 内 Map)各持一份;同一组不变量(TTL 命中 / 失败回落 lastGood / 从未成功)在三域测试间接重复断言,且 aihot 的「失败沿用旧数据」用例实未过 TTL——测的是缓存命中,lastGood 路径从未被真测。

**决策:三不变量单点 `common.ts cachedOrNull`;TtlCache 与 servermon 不收。**

1. **原语**:`get(key)`(TTL 命中回缓存不发上游;失败可选 console.warn + 回落 lastGood——键级、永不过期、含过期缓存;从未成功回 null)/ `invalidate`(写后失效,只清 TTL 缓存——lastGood 是底不清)/ `peek`(TTL 未过期的新鲜缓存,引用与 get 命中一致——「手动补一轮」类调用方区分命中/新抓/回落)/ `lastError`(最近失败原始因,成功即清——域选上抛时透传)。失败不续 TTL:下次调用即重试。键粒度由域选(单值源常量键、组合源序列化键)。「新抓成功」的域钩子(如趋势榜补译)**写在 fetch 回调内**——原语不设 onSuccess 钩子:曾有,终审发现「手动补一轮」调用方会与钩子对同一批缺口双发 fire-and-forget(ensure 无 in-flight 守卫,双倍 LLM 送译)而撤;钩子在 try 块内还会把同步抛错误分类为取数失败。
2. **迁移三域**:aihot(createCachedSource 外壳只留匿名 UA 外呼与响应裁剪)、dida(单键,速记/点掉后 invalidate 强制下读重拉)、trending(键 `since|lang|spoken` 序列化 + fetch 回调反解,补译在 fetch 回调内随新抓触发;retryTranslations 经 peek 三分:新鲜命中→显式补,现抓→回调自动轮已在途不叠发,过期回落→诚实上抛拒绝给旧榜补译;warnLabel 省缺——读路径 500 与 cron catch 已各记日志,原语再 warn 是三重噪音)。
3. **TtlCache 共存不并入**(动工前逐一核 7 个消费点,推翻架构评审「并入或共存」的并入预案):weather 五缓存是段级隐藏语义(air=null 即「省略该段」,回旧值 = 过期预警继续显示)、videoUpdates wbi 密钥按日更替(旧签名必 403)、siteInfo 表单辅助——全部「回旧值有害或无益」,并入即强加有害降级。
4. **servermon 不收**:失败续 TTL 防密集重试 + 批抓聚合 + 单项成败标 online/offline,与「失败即重试 + 单值回落」是语义分叉(ADR-0039「有分叉不合并」先例)。
5. **不变量直测进 common.test.ts**:含「TTL 过期 + 失败 → lastGood」原版从未真测的路径与键隔离/invalidate/钩子面;trending 译制用例的「首批记录」断言由同步改 until 轮询(去 fire-and-forget 微任务竞态,语义不变)。

**代价与取舍。** 换来:下一个「TTL + 宁旧勿空」域抄接口不抄全文;降级 bug 修一处惠及三域;不变量首次单点直测。付出:`get` 返回 `V | null` 把「从未成功」的域选(200 容忍 vs 上抛)留给调用方一行 if;trending 的键序列化/反解(`|` join/split)是原语不感知域查询对象的代价,三段值均不含 `|` 时安全。
