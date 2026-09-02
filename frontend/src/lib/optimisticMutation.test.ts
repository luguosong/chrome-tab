import { describe, expect, it } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { authoritativeCallbacks, optimisticCallbacks } from './optimisticMutation'
import { CONFIG_KEY } from '../api/config'
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

describe('optimisticCallbacks(config 形态)', () => {
  it('onMutate 乐观写并快照,onError 用快照还原', async () => {
    const qc = new QueryClient()
    qc.setQueryData(CONFIG_KEY, base)
    const cb = optimisticCallbacks(qc, CONFIG_KEY, delUpdater)

    const ctx = await cb.onMutate(2)
    expect(qc.getQueryData<Config>(CONFIG_KEY)?.icons.map((i) => i.id)).toEqual([1, 3])

    cb.onError(new Error('409'), 2, ctx)
    expect(qc.getQueryData<Config>(CONFIG_KEY)?.icons.map((i) => i.id)).toEqual([1, 2, 3])
  })

  it('updater 可改 pages(整份 Config 签名,useReorderPages 同款)', async () => {
    const qc = new QueryClient()
    qc.setQueryData(CONFIG_KEY, base)
    const cb = optimisticCallbacks<Config, Array<{ id: number; sortOrder: number }>>(
      qc,
      CONFIG_KEY,
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
    expect(qc.getQueryData<Config>(CONFIG_KEY)?.pages.map((p) => p.id)).toEqual([2, 1])
  })

  it('在途 GET 后到不覆盖乐观态(cancelQueries 防旧快照晚到)', async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { staleTime: 0, retry: false } },
    })
    await qc.fetchQuery({ queryKey: CONFIG_KEY, queryFn: async () => base })
    // 在途 refetch 挂起(真实场景:页面 stale 后的后台重拉)
    let resolveGet!: (c: Config) => void
    const inflight = qc.fetchQuery({
      queryKey: CONFIG_KEY,
      queryFn: () => new Promise<Config>((res) => (resolveGet = res)),
    })

    const cb = optimisticCallbacks(qc, CONFIG_KEY, delUpdater)
    await cb.onMutate(2)
    expect(qc.getQueryData<Config>(CONFIG_KEY)?.icons).toHaveLength(2)

    resolveGet(base) // 旧快照后到;若未取消,此处将覆盖乐观态(勾选框回弹同款坑)
    await inflight.then(
      () => {},
      () => {},
    )
    await new Promise((r) => setTimeout(r, 0))
    expect(qc.getQueryData<Config>(CONFIG_KEY)?.icons).toHaveLength(2)
  })

  it('缓存未载入时跳过乐观写且不炸', async () => {
    const qc = new QueryClient()
    const cb = optimisticCallbacks(qc, CONFIG_KEY, delUpdater)

    const ctx = await cb.onMutate(1)
    expect(ctx.prev).toBeUndefined()
    expect(() => cb.onError(new Error('net'), 1, ctx)).not.toThrow()
  })

  it('onSettled 失效聚合查询', async () => {
    const qc = new QueryClient()
    await qc.fetchQuery({ queryKey: CONFIG_KEY, queryFn: async () => base })
    const cb = optimisticCallbacks(qc, CONFIG_KEY, delUpdater)

    await cb.onSettled()
    expect(qc.getQueryState(CONFIG_KEY)?.isInvalidated).toBe(true)
  })
})

describe('optimisticCallbacks(null 语义,useTodo 收编形态)', () => {
  /** 自定义 key 顺带证明参数化:key 不过是缓存地址,与缓存形态 T 正交。 */
  const todoKey = ['ut-bundle'] as const
  type Bundle = { today: number[]; week: number[]; inbox: number[] }
  const removeId = (prev: Bundle, id: number) => ({
    today: prev.today.filter((x) => x !== id),
    week: prev.week.filter((x) => x !== id),
    inbox: prev.inbox.filter((x) => x !== id),
  })

  it('null 缓存跳过乐观写且不调 updater', async () => {
    const qc = new QueryClient()
    qc.setQueryData<Bundle | null>(todoKey, null)
    let updaterCalled = false
    const cb = optimisticCallbacks<Bundle | null, number>(qc, todoKey, (prev, id) => {
      updaterCalled = true
      return removeId(prev, id)
    })

    const ctx = await cb.onMutate(5)
    expect(updaterCalled).toBe(false)
    expect(qc.getQueryData<Bundle | null>(todoKey)).toBeNull()
    expect(ctx.prev).toBeNull()
  })

  it('null 快照照常还原(truthy 判还原会漏掉 null 的回滚)', async () => {
    const qc = new QueryClient()
    // 中间变量声明:TanStack setQueryData 对「含 null 联合 + 字面量」的泛型推断有坑
    const initial: Bundle | null = { today: [1], week: [], inbox: [1] }
    qc.setQueryData<Bundle | null>(todoKey, initial)
    const cb = optimisticCallbacks<Bundle | null, number>(qc, todoKey, removeId)

    // 乐观写后缓存被并发置 null(如后端清配置),快照还原仍应可达
    const ctx = await cb.onMutate(1)
    qc.setQueryData<Bundle | null>(todoKey, null)
    cb.onError(new Error('net'), 1, ctx)
    expect(qc.getQueryData<Bundle | null>(todoKey)).toEqual({ today: [1], week: [], inbox: [1] })
  })
})

describe('authoritativeCallbacks(权威写形态,useSetNewsSources/useSetKnownMark 收编形态)', () => {
  /** 已了解标记形态:string[] 全量(响应 = 写后全量,CONTEXT.md「已了解」)。 */
  const marksKey = ['ut-known'] as const

  it('onSuccess 整份写响应(响应即数据);失败静默由「仅此一个回调」构造保证', async () => {
    const qc = new QueryClient()
    const cb = authoritativeCallbacks<string[]>(qc, marksKey)

    await cb.onSuccess(['a', 'b'])
    expect(qc.getQueryData<string[]>(marksKey)).toEqual(['a', 'b'])
    // 无 onMutate(不产乐观态)/onError(无还原)/onSettled(无失效重拉)——
    // mutation 失败时缓存天然不动,「漏 cancel/漏还原」类 bug 无表达位
    expect(Object.keys(cb)).toEqual(['onSuccess'])
  })

  it('在途 GET 后到不覆盖权威值(cancelQueries 防勾选回弹同款坑)', async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { staleTime: 0, retry: false } },
    })
    await qc.fetchQuery({ queryKey: marksKey, queryFn: async () => ['old'] })
    // 在途 refetch 挂起(真实场景:列表 stale 后的后台重拉)
    let resolveGet!: (v: string[]) => void
    const inflight = qc.fetchQuery({
      queryKey: marksKey,
      queryFn: () => new Promise<string[]>((res) => (resolveGet = res)),
    })

    const cb = authoritativeCallbacks<string[]>(qc, marksKey)
    await cb.onSuccess(['a', 'b'])
    expect(qc.getQueryData<string[]>(marksKey)).toEqual(['a', 'b'])

    resolveGet(['old']) // 旧快照后到;若未取消,将覆盖写结果(勾选框回弹)
    await inflight.then(
      () => {},
      () => {},
    )
    await new Promise((r) => setTimeout(r, 0))
    expect(qc.getQueryData<string[]>(marksKey)).toEqual(['a', 'b'])
  })

  it('缓存未载入时照写(权威写无判空门——与乐观写门的差异点)', async () => {
    const qc = new QueryClient()
    const cb = authoritativeCallbacks<string[]>(qc, marksKey)

    await cb.onSuccess(['x'])
    expect(qc.getQueryData<string[]>(marksKey)).toEqual(['x'])
  })
})
