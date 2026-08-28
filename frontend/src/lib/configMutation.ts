import type { QueryClient } from '@tanstack/react-query'
import type { Config } from './types'

/** 乐观态计算:整份 Config 进出(动 icons 还是 pages 由各声明自定)。 */
export type OptimisticUpdater<V> = (prev: Config, vars: V) => Config

/**
 * ['config'] 聚合查询上的乐观 mutation 骨架(工厂,纯回调无 React 依赖):
 * onMutate 取消在途 GET → 快照 → 乐观写;onError 还原快照;onSettled invalidate
 * 重拉权威值(服务端权威,ADR-0006)。config 域写操作共用,变化点只有 mutationFn
 * 与乐观态算法(updater)。useUpdateLayoutSettings 的乐观写发生在松手前,不经此骨架。
 */
export function optimisticConfigCallbacks<V>(
  qc: QueryClient,
  updater: OptimisticUpdater<V>,
) {
  return {
    onMutate: async (vars: V) => {
      // 先取消在途 GET 再写缓存,防先发的旧快照后到覆盖乐观态(useTodo/useNews 先例)
      await qc.cancelQueries({ queryKey: ['config'] })
      const prev = qc.getQueryData<Config>(['config'])
      if (prev) qc.setQueryData<Config>(['config'], updater(prev, vars))
      return { prev }
    },
    onError: (
      _err: unknown,
      _vars: V,
      ctx: { prev: Config | undefined } | undefined,
    ) => {
      if (ctx?.prev) qc.setQueryData<Config>(['config'], ctx.prev)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['config'] }),
  }
}
