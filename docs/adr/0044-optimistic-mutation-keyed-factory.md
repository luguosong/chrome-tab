# 乐观 mutation 工厂按 key 参数化:config key 单点常量与「待办」收编

背景:「乐观 mutation」骨架(六份 onMutate 拷贝归一的 configMutation 工厂)焊死在 `['config']` + `Config` 上,协议知识存在 2.5 个持有点:工厂(config 域六写操作,有测试)、`useTodo` 手抄的五步(全前端唯一无测试的协议持有点)、`useNews` 的 onSuccess 变体。同时 `['config']` 字面量散布 8 文件 24 处(含 ConfigSyncProvider 缓存订阅的 `queryKey[0] !== 'config'` 字符串嗅探)——缓存协调机制(乐观写/快照还原/镜像落盘/拖拽会话新鲜度)的 key 形状无单一声明,且该区域已兑现过 bug(2080a3d 镜像落盘判别失效,TanStack 写协议暗坑两度记档)。

**决策:工厂去域化参数化 + key 单点常量 + 「待办」收编;三类形态明确不收。**

1. **`lib/configMutation.ts` → `lib/optimisticMutation.ts`**:`optimisticCallbacks<T, V>(qc, key, updater)`——key 与缓存类型由调用方声明,不再绑 Config。判空双层:乐观写门 `prev != null`(null 缓存跳过乐观写,updater 类型以 `NonNullable<T>` 表达「永不在空值上被调」——tsc 曾抓到此收窄未进签名的疏漏,类型即契约);还原门 `ctx.prev !== undefined`(null 快照照常还原——原工厂 truthy 判还原会漏掉 null 快照的回滚,useTodo 手抄版恰好写对,参数化时升为工厂显式契约)。config 六消费者零行为变化(Config 永非空)。
2. **key 单点**:`api/config.ts` 导出 `CONFIG_KEY`(todo 域私有 `TODO_KEY` 同理;useNews/useVideoUpdates 局部 KEYS 先例——域局部常量而非集中一表,加域不碰全局文件)。24 处代码字面量、缓存订阅嗅探(`CONFIG_KEY[0]` 比较)、reconcile.test 的模拟环境键全部改引常量;注释中的 `['config']` 保留自然语言(概念引用,非协议引用,控 churn)。
3. **「待办」收编**:useCompleteTodo 手抄五步退役,`<TodoBundle | null, TodoTask>` 走工厂——乐观协议持有点归一,原手抄份获得穿工厂接口的测试面;工厂测试新增 null 双层契约两组用例(null 缓存不写不调 updater、null 快照照常还原)。
4. **明确不收(防重提)**:①useNews 勾选的 onSuccess 权威写——响应即数据、无乐观写无还原,协议形态不同且唯一消费者,一个 adapter 的 seam 是假 seam;②invalidate-only mutation(config 域 6 个 + video 域 7 个)——每处一行,换常量后已是 `queryKey: CONFIG_KEY`,再收助手只省半行;③布局草稿与拖拽乐观流——既有例外,CONTEXT.md「乐观 mutation」词条已记(不以取消在途为前提)。

**代价与取舍。** 换来:缓存 key 形状一变只动一处;乐观协议「漏取消在途/漏还原」类别 bug 从结构上只可能发生在一处且该处有直测;useTodo 乐观行为(点掉即消失、失败回滚)首次进入测试面。付出:调用方多写显式泛型参数(`<Config, V>`);TanStack setQueryData 对「含 null 联合 + 字面量」的泛型推断有坑,测试以中间变量声明规避;文件与导出名变更波及词条、import 与注释引用(名实相符换波及面)。
