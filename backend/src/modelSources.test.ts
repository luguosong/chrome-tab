import { afterEach, expect, it, vi } from 'vitest'
import { openDb } from './db'
import { ModelTrackingService } from './modelTracking'
import { ZHIPU_DEF } from './providers/zhipu'

afterEach(() => vi.useRealTimers())

it('定时轮按 last_attempt 分三档跳过，重启仍守档位，慢档健康不受发布失败影响', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-13T00:00:00Z'))
  const { db } = openDb(':memory:')
  const fetchText = vi.fn(async () => '官方资料')
  const deps = { fetchText, env: {} }
  const svc = new ModelTrackingService(db, deps)
  await svc.pollProvider()
  const status = () => db.selectFrom('model_fetch_status').selectAll().where('provider', '=', 'zhipu').execute()
  expect(await status()).toHaveLength(6)
  const first = await status()
  expect(first.find((s) => s.role === 'pricing')).toMatchObject({ stale: 0 })
  expect(first.find((s) => s.role === 'release')).toMatchObject({ stale: 1 })
  fetchText.mockClear()
  vi.setSystemTime(new Date('2026-09-13T01:59:59Z'))
  await new ModelTrackingService(db, deps).pollProvider()
  expect(fetchText).not.toHaveBeenCalled()
  vi.setSystemTime(new Date('2026-09-13T02:00:00Z'))
  await svc.pollProvider()
  expect((await status()).find((s) => s.role === 'catalog')!.last_attempt_at).toBe('2026-09-13T00:00:00.000Z')
  expect((await status()).find((s) => s.role === 'release')!.last_attempt_at).toBe('2026-09-13T02:00:00.000Z')
  vi.setSystemTime(new Date('2026-09-13T06:00:00Z'))
  await svc.pollProvider()
  expect((await status()).find((s) => s.role === 'catalog')!.last_attempt_at).toBe('2026-09-13T06:00:00.000Z')
  expect((await status()).find((s) => s.role === 'pricing')).toMatchObject({ stale: 0, last_attempt_at: '2026-09-13T00:00:00.000Z' })
  vi.setSystemTime(new Date('2026-09-14T00:00:00Z'))
  await svc.pollProvider()
  expect((await status()).find((s) => s.role === 'pricing')!.last_attempt_at).toBe('2026-09-14T00:00:00.000Z')
  await db.destroy()
})

it('失败只标当前角色陈旧，保留快照与成功时间，下一档到期成功后恢复', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-13T00:00:00Z'))
  const { db } = openDb(':memory:')
  let fail = false
  const svc = new ModelTrackingService(db, { env: {}, fetchText: async (url) => {
    if (fail && url === ZHIPU_DEF.sources.pricing.urls[0]) throw new Error('HTTP 503')
    return '官方资料'
  } })
  const pricing = () => db.selectFrom('model_fetch_status').selectAll().where('provider', '=', 'zhipu').where('role', '=', 'pricing').executeTakeFirstOrThrow()
  await svc.pollProvider()
  const original = await pricing()
  fail = true
  vi.setSystemTime(new Date('2026-09-14T00:00:00Z'))
  await svc.pollProvider()
  expect(await pricing()).toMatchObject({ stale: 1, pages: original.pages, fingerprint: original.fingerprint, last_success_at: original.last_success_at })
  expect(await db.selectFrom('model_fetch_status').select('stale').where('provider', '=', 'zhipu').where('role', '=', 'limits').executeTakeFirstOrThrow()).toEqual({ stale: 0 })
  fail = false
  vi.setSystemTime(new Date('2026-09-14T02:00:00Z'))
  await svc.pollProvider()
  expect((await pricing()).stale).toBe(1) // 失败也按 last_attempt 退避，不能在快档密集重试
  vi.setSystemTime(new Date('2026-09-15T00:00:00Z'))
  await svc.pollProvider()
  expect(await pricing()).toMatchObject({ stale: 0, last_success_at: '2026-09-15T00:00:00.000Z' })
  await db.destroy()
})

it('HTML 页指纹只认正文变化，页面脚本变化不触发重核', async () => {
  vi.useFakeTimers()
  const { db } = openDb(':memory:')
  let script = 'a', price = '1'
  const svc = new ModelTrackingService(db, { env: {}, fetchText: async () =>
    `<html><head><script>${script}</script></head><body><main>价格 ${price} 元</main></body></html>`,
  })
  const pricing = () => db.selectFrom('model_fetch_status').select(['pages', 'fingerprint']).where('provider', '=', 'zhipu').where('role', '=', 'pricing').executeTakeFirstOrThrow()
  vi.setSystemTime(new Date('2026-09-13T00:00:00Z'))
  await svc.pollProvider()
  const first = await pricing()
  script = 'b'
  vi.setSystemTime(new Date('2026-09-14T00:00:00Z'))
  await svc.pollProvider()
  expect(await pricing()).toEqual(first)
  price = '2'
  vi.setSystemTime(new Date('2026-09-15T00:00:00Z'))
  await svc.pollProvider()
  expect((await pricing()).fingerprint).not.toBe(first.fingerprint)
  await db.destroy()
})

it('健康预算按角色区分：同为 7 小时前成功，目录陈旧而价格仍新鲜', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-13T07:00:00Z'))
  const { db } = openDb(':memory:')
  for (const role of ['catalog', 'pricing']) await db.insertInto('model_fetch_status').values({
    provider: 'zhipu', role, stale: 0, last_success_at: '2026-09-13T00:00:00.000Z',
    last_attempt_at: '2026-09-13T06:00:00.000Z',
  }).execute()
  await new ModelTrackingService(db, { env: {}, fetchText: async () => '官方资料' }).pollProvider()
  const rows = await db.selectFrom('model_fetch_status').select(['role', 'stale']).where('provider', '=', 'zhipu').execute()
  expect(rows).toEqual(expect.arrayContaining([{ role: 'catalog', stale: 1 }, { role: 'pricing', stale: 0 }]))
  await db.destroy()
})

it('抓取有耗时且 cron 有毫秒抖动时，相邻 2h 轮不能误跳过', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-13T00:41:00.010Z'))
  const { db } = openDb(':memory:')
  const svc = new ModelTrackingService(db, { env: {}, fetchText: async () => {
    vi.setSystemTime(Date.now() + 1000)
    return '官方资料'
  } })
  const attempt = () => db.selectFrom('model_fetch_status').select('last_attempt_at').where('provider', '=', 'zhipu').where('role', '=', 'release').executeTakeFirstOrThrow()
  await svc.pollProvider()
  expect((await attempt()).last_attempt_at).toBe('2026-09-13T00:41:00.000Z')
  vi.setSystemTime(new Date('2026-09-13T02:41:00.001Z'))
  await svc.pollProvider()
  expect((await attempt()).last_attempt_at).toBe('2026-09-13T02:41:00.000Z')
  await db.destroy()
})
