# 轮询落库骨架单点 pollPersist:尾链串行器与「同事务先插后裁」入库纪律

背景:「定时轮询预取落库」范式(ADR-0023/0027)在 news 与 videoUpdates 两域各持一份同构拷贝:①promise 尾链串行器三份逐字同形(news.enqueue / videoUpdates.enqueue / changelog.exclusive,后者多一句 phase 复位);②入库裁剪 saveItems/saveVideos ~30 行×2,「事务内逐条 onConflict doNothing + delete not in top-50 子查询」结构同构,列组/冲突键/排序键字面量各异;③失败 streak 两套写法(SQL 原子自增 vs JS 读改写)。拷贝的税已实证:news 裁剪键 bug(裸 id 会把首个 feed 的条目整批删光)修在一份上,videoUpdates 靠「published_at 必填」巧合幸免,读者须自行重推它为何不需要同样的修复。

**决策:骨架收进 `backend/src/pollPersist.ts`;三个「不收」同样记档,防未来评审重提。**

1. **`makeTailQueue()`**:尾链串行器工厂,interface = `{ enqueue, idle }`。news/video 各自实例化(private queue);**changelog 的 exclusive 不迁**——它的 phase 复位是「译制阶段」词条的载体(idle→translating、「排队中」语义),为 1/3 成员加 onDrain 可选参数违反 ADR-0038 §6 的 shallow 警戒(为少数成员撑宽 interface 换假完备)。三份注释互指退化为两份指向 changelog。
2. **`upsertThenPrune(db, rows, upsertOne, prune)`**:入库纪律原语——同事务内先逐条 upsert 全部新行、后按窗口裁剪。顺序是承重墙:裁剪子查询必须看到本轮全量插入,拆成两事务则窗口逐轮翻转(news 裁剪键 bug 的教训口径)。**表字面量(列组/冲突键/排序键)以回调留域**,不下沉进本文件:第三个落库域接入时不动机制文件(与 ADR-0038「新增厂家不改骨架」同向);同 ADR-0032 callModel 的哲学——共享的只是最小纪律单元,域差异留外层。
3. **streak 不收**:news 的 SQL 原子自增批量更新(`set fail_streak = fail_streak+1` 按 source×enabled 一轮批量)与 video 的 JS 读改写单行更新是两种正确形态;统一任一方都是已声明行为漂移,唯一收益是常量对齐——「连续失败 ≈ 1 天」口径(30min×48 = 1h×24)靠注释互指已足够。
4. **「0 条语义」归取数层,入库原语不解释空**:news 拉空 = 上游改版/风控信号,pollSource 判失败计 streak(空池还立即补试一次);video 拉空 = 博主未投稿,事务空转 + markSuccess 照标。两域对「空」的不同解释都发生在取数层,upsertThenPrune 不掺和——news 侧 saveItems 原有的 `if (items.length === 0) return` 经核为不可达死守卫(唯一调用方 pollSource 在空时已无条件 throw),随本 ADR 删除,两侧 saveXxx 对空自然对称(空数组循环零次,事务无害空转)。
5. **验收 = 零行为变化**:两域既有测试(fake deps + 真 SQLite + `idle()` 对账,全走 Service 公有 interface)零改动全绿;新增 `pollPersist.test.ts` 直测 makeTailQueue 三条不变量(顺序 / 前序失败不阻塞后来者 / idle 对账口径)——抽成独立 seam 后自证(interface 即测试面);入库纪律不重复直测,两域既有「50 条裁剪」用例已穿真实 interface 覆盖。全量 485→488。

**代价与取舍。** 换来:入库纪律(同事务先插后裁)从「调用方记得」变结构保证,第三消费者不可能抄错;尾链容错(rejection 续传、tail 接续)单点直测;下一处「轮询落库」域接入抄 pollPersist 模板而非抄 news 全文。付出:域内 saveItems/saveVideos 行数基本不变(字面量回调留域,只是事务包裹与循环退场)——深化的收益在纪律单点与测试面,不在行数。code-review 随本 ADR 落地三项修正:`Tx` 直取 Kysely 导出的 `Transaction<SchemaDatabase>`(初版 `Parameters` 双层提取系绕路);makeTailQueue 返回类型推断、不立具名 interface(仓库工厂惯例,无第二实现);video 侧裁剪回调补「published_at NOT NULL 是承重」注释——裸列排序模板被可空新鲜度列的第三域照抄时,会重演窗口逐轮翻转的裁剪键 bug,注释把抄模板的岔路口标出来。
