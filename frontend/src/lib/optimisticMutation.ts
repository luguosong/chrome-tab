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
 * 还原语义;「新闻」勾选是 onSuccess 权威写(响应即数据,无乐观写无还原)。
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
