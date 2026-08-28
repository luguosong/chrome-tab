import type { Transaction } from 'kysely'
import type { SchemaDatabase } from './schema'
import type { Db } from './db'

/**
 * 轮询落库骨架(ADR-0039):「定时轮询预取落库」域(news、videoUpdates)的两个
 * 横切件单点——尾链串行器与「同事务先全量 upsert、后按窗口裁剪」的入库纪律。
 * 列组/冲突键/裁剪排序键等表字面量由各域以回调持有(同 ADR-0034 判别分派把
 * 表字面量留在分派支的取向,但分支不下沉进本文件:第三个落库域接入不动此处)。
 *
 * 明确不收(ADR-0039 记档):streak 失败判定(news 的 SQL 原子自增批量更新与
 * video 的 JS 读改写单行更新是两种正确形态);「0 条语义」守卫(news 拉空 = 上游
 * 改版信号判失败,video 拉空 = 博主未投稿算成功);changelog 的 exclusive 尾链
 * (phase 复位是「译制阶段」载体,真域差异)。
 */

/** 事务连接类型(与 Db 同 schema;Kysely 直接导出,勿用 Parameters 提取绕路)。 */
type Tx = Transaction<SchemaDatabase>

/**
 * promise 尾链:cron 轮询与用户触发的首取排同一条链串行。enqueue 的任务排到链尾
 * 串行执行、前序失败不阻塞后来者(失败各自上抛给提交方);idle 等当前链排空(测试
 * 对账)。返回类型推断,不立具名 interface(仓库工厂惯例,无第二实现)。
 */
export function makeTailQueue() {
  let tail: Promise<unknown> = Promise.resolve()
  return {
    enqueue<T>(fn: () => Promise<T>): Promise<T> {
      const run = tail.then(fn, fn) // 前序失败不阻塞后来者
      tail = run.catch(() => {})
      return run
    },
    async idle() {
      await tail
    },
  }
}

/**
 * 入库纪律(单点):同一事务内先逐条 upsert 全部新行、后按窗口裁剪——顺序是
 * 承重墙:裁剪子查询必须看到本轮全量插入,拆成两事务则窗口逐轮翻转(news 裁剪
 * 键 bug 的教训口径)。0 条守卫留域(见文件头):video 侧空数组事务空转无害,
 * news 侧由调用方判失败,本函数不替域解释「空」。
 */
export async function upsertThenPrune<T>(
  db: Db,
  rows: readonly T[],
  upsertOne: (tx: Tx, row: T) => Promise<unknown>,
  prune: (tx: Tx) => Promise<unknown>,
): Promise<void> {
  await db.transaction().execute(async (tx) => {
    for (const row of rows) await upsertOne(tx, row)
    await prune(tx)
  })
}
