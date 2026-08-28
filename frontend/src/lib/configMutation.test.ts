import { describe, expect, it } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { optimisticConfigCallbacks } from './configMutation'
import type { Config, Icon, LayoutSettings } from './types'

const page = (id: number) => ({ id, name: `p${id}`, sortOrder: id })
const icon = (id: number): Icon => ({
  id,
  pageId: 1,
  parentId: null,
  type: 'nav',
  sortOrder: id,
  data: null,
})
const base: Config = {
  pages: [page(1), page(2)],
  icons: [icon(1), icon(2), icon(3)],
  layoutSettings: {} as LayoutSettings,
  updatedAt: null,
}
/** 镜像 useDeleteIcon 声明的 updater,作测试载体。 */
const delUpdater = (prev: Config, id: number) => ({
  ...prev,
  icons: prev.icons.filter((i) => i.id !== id),
})

describe('optimisticConfigCallbacks', () => {
  it('onMutate 乐观写并快照,onError 用快照还原', async () => {
    const qc = new QueryClient()
    qc.setQueryData(['config'], base)
    const cb = optimisticConfigCallbacks(qc, delUpdater)

    const ctx = await cb.onMutate(2)
    expect(qc.getQueryData<Config>(['config'])?.icons.map((i) => i.id)).toEqual([1, 3])

    cb.onError(new Error('409'), 2, ctx)
    expect(qc.getQueryData<Config>(['config'])?.icons.map((i) => i.id)).toEqual([1, 2, 3])
  })

  it('updater 可改 pages(整份 Config 签名,useReorderPages 同款)', async () => {
    const qc = new QueryClient()
    qc.setQueryData(['config'], base)
    const cb = optimisticConfigCallbacks<Array<{ id: number; sortOrder: number }>>(
      qc,
      (prev, items) => {
        const order = new Map(items.map((it) => [it.id, it.sortOrder]))
        return {
          ...prev,
          pages: [...prev.pages].sort(
            (a, b) =>
              (order.get(a.id) ?? a.sortOrder) - (order.get(b.id) ?? b.sortOrder),
          ),
        }
      },
    )

    await cb.onMutate([{ id: 1, sortOrder: 2 }, { id: 2, sortOrder: 1 }])
    expect(qc.getQueryData<Config>(['config'])?.pages.map((p) => p.id)).toEqual([2, 1])
  })

  it('在途 GET 后到不覆盖乐观态(cancelQueries 防旧快照晚到)', async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { staleTime: 0, retry: false } },
    })
    await qc.fetchQuery({ queryKey: ['config'], queryFn: async () => base })
    // 在途 refetch 挂起(真实场景:页面 stale 后的后台重拉)
    let resolveGet!: (c: Config) => void
    const inflight = qc.fetchQuery({
      queryKey: ['config'],
      queryFn: () => new Promise<Config>((res) => (resolveGet = res)),
    })

    const cb = optimisticConfigCallbacks(qc, delUpdater)
    await cb.onMutate(2)
    expect(qc.getQueryData<Config>(['config'])?.icons).toHaveLength(2)

    resolveGet(base) // 旧快照后到;若未取消,此处将覆盖乐观态(勾选框回弹同款坑)
    await inflight.then(
      () => {},
      () => {},
    )
    await new Promise((r) => setTimeout(r, 0))
    expect(qc.getQueryData<Config>(['config'])?.icons).toHaveLength(2)
  })

  it('缓存未载入时跳过乐观写且不炸', async () => {
    const qc = new QueryClient()
    const cb = optimisticConfigCallbacks(qc, delUpdater)

    const ctx = await cb.onMutate(1)
    expect(ctx.prev).toBeUndefined()
    expect(() => cb.onError(new Error('net'), 1, ctx)).not.toThrow()
  })

  it('onSettled 失效聚合查询', async () => {
    const qc = new QueryClient()
    await qc.fetchQuery({ queryKey: ['config'], queryFn: async () => base })
    const cb = optimisticConfigCallbacks(qc, delUpdater)

    await cb.onSettled()
    expect(qc.getQueryState(['config'])?.isInvalidated).toBe(true)
  })
})
