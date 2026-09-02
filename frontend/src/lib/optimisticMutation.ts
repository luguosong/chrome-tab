import type { QueryClient } from '@tanstack/react-query'

/** 乐观态计算:整份缓存值进出(动 icons 还是 pages 由各声明自定)。prev 类型
 *  为 NonNullable<T>——工厂写门保证 null 缓存跳过乐观写,updater 永不在空值上被调。 */
export type OptimisticUpdater<T, V> = (prev: NonNullable<T>, vars: V) => T

/**
 * 聚合查询上的乐观 mutation 骨架(工厂,纯回调无 React 依赖):
 * onMutate 取消在途 GET → 快照 → 乐观写;onError 还原快照;onSettled invalidate
 * 重拉权威值(服务端权威,ADR-0006)。key 与缓存类型由调用方声明——config 域
 * 六写操作(key = CONFIG_KEY)与「待办」点掉完成(key = TODO_KEY,T 可为 null)
 * 共用(ADR-0044),变化点只有 mutationFn 与乐观态算法(updater)。
 *
 * 判空两层:乐观写门 `prev != null`(null 缓存跳过,updater 只吃非空);
 * 还原门 `ctx.prev !== undefined`(null 快照照常还原——快照存在与否与值真假
 * 正交,truthy 判还原会漏掉 null 快照的回滚)。
 *
 * 不经此骨架的例外(CONTEXT.md「乐观 mutation」词条):「布局草稿」的乐观写
 * 发生在松手前;「拖拽编排」的连续乐观流靠松手落定的失效重拉自愈,均无快照
 * 还原语义。「新闻」勾选与「已了解」标记的 onSuccess 权威写走下方姊妹出口
 * authoritativeCallbacks,不在例外之列。
 */
export function optimisticCallbacks<T, V>(
  qc: QueryClient,
  key: readonly unknown[],
  updater: OptimisticUpdater<T, V>,
) {
  return {
    onMutate: async (vars: V) => {
      // 先取消在途 GET 再写缓存,防先发的旧快照后到覆盖乐观态(useTodo/useNews 先例)
      await qc.cancelQueries({ queryKey: key })
      const prev = qc.getQueryData<T>(key)
      if (prev != null) qc.setQueryData<T>(key, updater(prev, vars))
      return { prev }
    },
    onError: (
      _err: unknown,
      _vars: V,
      ctx: { prev: T | undefined } | undefined,
    ) => {
      if (ctx?.prev !== undefined) qc.setQueryData<T>(key, ctx.prev)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  }
}

/**
 * 权威写出口(optimisticCallbacks 的姊妹,同文件单点):onSuccess 取消在途
 * GET → 整份写响应。「响应即数据」——响应本身就是服务端写后权威值(SQLite
 * 点写毫秒级,不做乐观回滚),故无乐观写、无快照还原、无失效重拉;仅此一个
 * 回调即是「mutation 失败时缓存不动」的静默语义(无 onMutate 就无乐观态可
 * 还原,无 onError 就无还原可漏)。消费方仅声明 mutationFn:「新闻」勾选
 * (key = news feed)与「已了解」标记(key = known marks,响应 = 写后全量)。
 */
export function authoritativeCallbacks<T>(
  qc: QueryClient,
  key: readonly unknown[],
) {
  return {
    onSuccess: async (data: T) => {
      // 先取消在途 GET 再写缓存,防先发的旧快照后到覆盖权威值(勾选框回弹;
      // 取消前提与乐观骨架同源,useSetNewsSources 手抄序列收编而来)
      await qc.cancelQueries({ queryKey: key })
      qc.setQueryData(key, data)
    },
  }
}
