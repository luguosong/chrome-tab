import { beforeAll, describe, expect, it } from 'vitest'
import { expectError, setupApp } from './testUtils'

// api-contract §4 + 修正白名单②⑤。fixture:seed 3 页(id 1/2/3,sortOrder 0/1/2)。
let req: Awaited<ReturnType<typeof setupApp>>['req']
let login: () => Promise<string>
let cookie: string
let db: Awaited<ReturnType<typeof setupApp>>['db']

beforeAll(async () => {
  const s = await setupApp()
  req = s.req
  login = s.login
  db = s.db
  cookie = await login()
})

describe('POST /api/pages', () => {
  it('happy:201(修正白名单②)返回 {id,name,sortOrder},sortOrder=末尾+1,落库 trim', async () => {
    const res = await req('POST', '/api/pages', { body: { name: '  新页  ' }, cookie })
    expect(res.status).toBe(201)
    await expect(res.json()).resolves.toEqual({ id: 4, name: '新页', sortOrder: 3 })
    expect(await db.selectFrom('pages').select('name').where('id', '=', 4).executeTakeFirstOrThrow()).toEqual({ name: '新页' })
  })

  it('空白/缺失 name、超 64 字 → 400 {status,message}', async () => {
    for (const body of [{ name: '  ' }, { name: 42 }, {}, { name: 'x'.repeat(65) }]) {
      await expectError(await req('POST', '/api/pages', { body, cookie }), 400)
    }
    // 65 字的 400 不落库
    expect(await db.selectFrom('pages').select('id').where('name', '=', 'x'.repeat(65)).execute()).toHaveLength(0)
  })

  it('未认证 401 空体', async () => {
    const res = await req('POST', '/api/pages', { body: { name: 'x' } })
    expect(res.status).toBe(401)
    expect(await res.text()).toBe('')
  })
})

describe('PATCH /api/pages/reorder', () => {
  it('happy(修正白名单⑤):响应按新序排列,顶层 sortOrder 0..n-1 无空洞;静默跳过不存在 id', async () => {
    // seed 3 页 + 测试自建 1 页(sortOrder 999)。倒序提交 4 个真实 id + 1 个不存在的 id
    const res = await req('PATCH', '/api/pages/reorder', {
      body: [
        { id: 1, sortOrder: 3 },
        { id: 2, sortOrder: 2 },
        { id: 3, sortOrder: 1 },
        { id: 4, sortOrder: 0 },
        { id: 9999, sortOrder: 7 },
      ],
      cookie,
    })
    expect(res.status).toBe(200)
    const pages = (await res.json()) as Array<{ id: number; sortOrder: number }>
    // negative 断言:不再按读库旧序(旧序应为 [1,2,3,4]),而是按新序 [4,3,2,1]
    expect(pages.map((p) => p.id)).toEqual([4, 3, 2, 1])
    expect(pages.map((p) => p.sortOrder)).toEqual([0, 1, 2, 3])
    // id 9999 静默跳过,不炸不落
    expect(await db.selectFrom('pages').select('id').where('id', '=', 9999).execute()).toHaveLength(0)
  })

  it('非数组 body / 项缺 id → 400;重复 id 首个生效(对齐 Java findFirst)', async () => {
    await expectError(await req('PATCH', '/api/pages/reorder', { body: { id: 1 }, cookie }), 400)
    await expectError(await req('PATCH', '/api/pages/reorder', { body: [{ sortOrder: 1 }], cookie }), 400)
    const res = await req('PATCH', '/api/pages/reorder', {
      body: [
        { id: 1, sortOrder: 0 },
        { id: 2, sortOrder: 1 },
        { id: 1, sortOrder: 9 }, // 重复:末项不得覆盖首项
      ],
      cookie,
    })
    expect(res.status).toBe(200)
    const pages = (await res.json()) as Array<{ id: number; sortOrder: number }>
    expect(pages.find((p) => p.id === 1)!.sortOrder).toBe(0)
  })
})

describe('PUT /api/pages/{id}', () => {
  it('happy:200 {id,name,sortOrder},name trim', async () => {
    const res = await req('PUT', '/api/pages/4', { body: { name: '  改名  ' }, cookie })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ id: 4, name: '改名', sortOrder: 0 })
  })

  it('不存在/不属当前 user 的 id → 404 页面不存在', async () => {
    await expectError(await req('PUT', '/api/pages/999', { body: { name: 'x' }, cookie }), 404, '页面不存在')
  })

  it('畸形 name → 400', async () => {
    await expectError(await req('PUT', '/api/pages/4', { body: { name: '' }, cookie }), 400)
  })
})

describe('DELETE /api/pages/{id}', () => {
  it('happy:空页 204 无体,行删除', async () => {
    const res = await req('DELETE', '/api/pages/4', { cookie })
    expect(res.status).toBe(204)
    expect(await res.text()).toBe('')
    expect(await db.selectFrom('pages').select('id').where('id', '=', 4).execute()).toHaveLength(0)
  })

  it('negative:非空页 409 该页非空(带 seed 图标的页)', async () => {
    await expectError(await req('DELETE', '/api/pages/1', { cookie }), 409, '该页非空，请先移动或删除页内图标')
  })

  it('不存在 → 404', async () => {
    await expectError(await req('DELETE', '/api/pages/999', { cookie }), 404, '页面不存在')
  })
})

describe('config_version bump(ADR-0006)', () => {
  it('任意页写后 updatedAt 前进;失败写(409)不前进', async () => {
    const before = (
      await db.selectFrom('config_version').select('updated_at').where('user_id', '=', 1).executeTakeFirstOrThrow()
    ).updated_at
    await db.updateTable('config_version').set({ updated_at: '2000-01-01T00:00:00.000Z' }).where('user_id', '=', 1).execute()
    await req('POST', '/api/pages', { body: { name: 'bump' }, cookie })
    const after = (
      await db.selectFrom('config_version').select('updated_at').where('user_id', '=', 1).executeTakeFirstOrThrow()
    ).updated_at
    expect(after > '2000-01-01T00:00:00.000Z').toBe(true)
    expect(after).not.toBe(before)
    // 409 不 bump:再固定旧值,触发失败写
    await db.updateTable('config_version').set({ updated_at: '2000-01-01T00:00:00.000Z' }).where('user_id', '=', 1).execute()
    await req('DELETE', '/api/pages/1', { cookie })
    expect(
      (await db.selectFrom('config_version').select('updated_at').where('user_id', '=', 1).executeTakeFirstOrThrow())
        .updated_at,
    ).toBe('2000-01-01T00:00:00.000Z')
  })
})

describe('未映射路径', () => {
  it('旧端点 /api/nav-links、任意未知 /api 路径 → 404 {status:404, message:"资源不存在"}', async () => {
    await expectError(await req('DELETE', '/api/nav-links', { cookie }), 404, '资源不存在')
    await expectError(await req('GET', '/api/stock-watches', { cookie }), 404, '资源不存在')
  })
})
