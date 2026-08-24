import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../api/client'
import type { TodoBundle, TodoTask } from '../lib/todo'

/**
 * 滴答待办取数与写回(单例图标,CONTEXT.md「待办」;首个可写类型)。不进
 * IconDataContext 集中层:单例无批量红利,且未添加该图标的用户不应发请求
 * (同 aihot/changelog 先例)。图标 body 与 Modal 各自调用,同 queryKey 天然去重。
 *
 * 数据 = 三视图 bundle(today/week/inbox,后端分拣)。后端内存缓存 60s(写操作
 * 即清);前端 30s staleTime + 5min 轮询维持温度。勾选完成走乐观更新(点掉即从
 * 当前视图消失,失败回滚);速记创建落收集箱,成功后 invalidate 对账。
 */
export function useTodo() {
  return useQuery<TodoBundle | null>({
    queryKey: ['todo'],
    queryFn: () => apiFetch<TodoBundle | null>('/api/todo'),
    staleTime: 30_000,
    refetchInterval: 5 * 60_000,
    retry: 1,
  })
}

/** 点掉即完成:从三视图乐观移除,失败回滚快照,收尾 invalidate 对账。 */
export function useCompleteTodo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (t: TodoTask) =>
      apiFetch('/api/todo/complete', {
        method: 'POST',
        body: JSON.stringify({ projectId: t.projectId, taskId: t.id }),
      }),
    onMutate: async (t) => {
      await qc.cancelQueries({ queryKey: ['todo'] })
      const prev = qc.getQueryData<TodoBundle | null>(['todo'])
      if (prev) {
        qc.setQueryData<TodoBundle>(['todo'], {
          today: prev.today.filter((x) => x.id !== t.id),
          week: prev.week.filter((x) => x.id !== t.id),
          inbox: prev.inbox.filter((x) => x.id !== t.id),
        })
      }
      return { prev }
    },
    onError: (_e, _t, ctx) => {
      if (ctx?.prev !== undefined) qc.setQueryData<TodoBundle | null>(['todo'], ctx.prev)
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ['todo'] }),
  })
}

/** 速记:一行标题 → 滴答收集箱。 */
export function useCreateTodo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (title: string) =>
      apiFetch('/api/todo', { method: 'POST', body: JSON.stringify({ title }) }),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['todo'] }),
  })
}
