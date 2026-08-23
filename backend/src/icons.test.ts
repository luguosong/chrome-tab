import { beforeAll, describe, expect, it } from 'vitest'
import type { Db } from './db'
import { expectError, insertPage, setupApp } from './testUtils'

// api-contract §5 + 修正白名单②④⑥ + ADR-0011 分组语义。
// fixture:seed 页1=12 NAV(id 1..12)、页2=1 CHANGELOG(id 13)、页3=13 STOCK(id 14..26)。
// 容量/组边角 fixture 直插 db(绕开 HTTP);排序不变量统一断言 0..n-1 无空洞。

let req: Awaited<ReturnType<typeof setupApp>>['req']
let cookie: string
let db: Db

beforeAll(async () => {
  const s = await setupApp()
  req = s.req
  db = s.db
  cookie = await s.login()
})

/** 直插 n 个顶层 NAV 到新页,返回 [pageId, 首个IconId] */
async function navPage(n: number, name = 'p'): Promise<[number, number]> {
  const pageId = await insertPage(db, 1, name)
  const now = new Date().toISOString()
  const rows = await db
    .insertInto('icons')
    .values(
      Array.from({ length: n }, (_, i) => ({
        user_id: 1, page_id: pageId, parent_id: null, type: 'NAV', sort_order: i,
        data: JSON.stringify({ name: `n${i}`, url: `https://x/${i}` }), created_at: now,
      })),
    )
    .returning('id')
    .execute()
  return [pageId, rows[0]!.id]
}

/** 页面顶层序列的 sort_order 列表(断言无空洞用) */
async function topOrders(pageId: number): Promise<number[]> {
  const rows = await db
    .selectFrom('icons')
    .select('sort_order')
    .where('page_id', '=', pageId)
    .where('parent_id', 'is', null)
    .orderBy('sort_order', 'asc')
    .execute()
  return rows.map((r) => r.sort_order)
}

/** 组内成员的 [id, sort_order] 列表 */
async function memberOrder(groupId: number): Promise<Array<[number, number]>> {
  const rows = await db
    .selectFrom('icons')
    .select(['id', 'sort_order'])
    .where('parent_id', '=', groupId)
    .orderBy('sort_order', 'asc')
    .execute()
  return rows.map((r) => [r.id, r.sort_order])
}

async function mergeIcons(pageId: number, memberIds: number[]): Promise<number> {
  const res = await req('POST', '/api/icons/merge', { body: { pageId, memberIds }, cookie })
  expect(res.status).toBe(201)
  return ((await res.json()) as { id: number }).id
}

describe('契约顶部:未认证 401 空体', () => {
  it('POST /api/icons 无 cookie → 401 空体', async () => {
    const res = await req('POST', '/api/icons', { body: { pageId: 1, type: 'WEATHER', data: null } })
    expect(res.status).toBe(401)
    expect(await res.text()).toBe('')
  })
})

describe('POST /api/icons', () => {
  it('happy:201 IconResponse(大写枚举、data 对象透传、末尾追加 sortOrder=12)', async () => {
    const res = await req('POST', '/api/icons', {
      body: { pageId: 1, type: 'WEATHER', data: { location: { name: '北京', adm1: '北京', adm2: '北京', lat: 39.9, lon: 116.4 } } },
      cookie,
    })
    expect(res.status).toBe(201)
    await expect(res.json()).resolves.toEqual({
      id: expect.any(Number),
      pageId: 1,
      parentId: null,
      type: 'WEATHER',
      sortOrder: 12,
      data: { location: { name: '北京', adm1: '北京', adm2: '北京', lat: 39.9, lon: 116.4 } },
    })
  })

  it('409 GROUP 不能直接建 / CHANGELOG 可多实例(ADR-0020) / 满页容量(剩余 0 格)', async () => {
    await expectError(await req('POST', '/api/icons', { body: { pageId: 1, type: 'GROUP', data: null }, cookie }), 409, '分组需经合并创建，不能直接新建')
    // CHANGELOG 已非单例:seed 已有一条,再建第二条(另一源)合法
    {
      const res = await req('POST', '/api/icons', { body: { pageId: 1, type: 'CHANGELOG', data: { source: 'matt-skills' } }, cookie })
      expect(res.status).toBe(201)
    }
    const [fullPage] = await navPage(64)
    await expectError(
      await req('POST', '/api/icons', { body: { pageId: fullPage, type: 'WEATHER', data: null }, cookie }),
      409, '页面容量不足，剩余 0 格',
    )
  })

  it('404 页面不存在;400 非法 type(含小写)/缺 pageId/data 非对象', async () => {
    await expectError(await req('POST', '/api/icons', { body: { pageId: 999, type: 'NAV', data: null }, cookie }), 404, '页面不存在')
    for (const body of [
      { pageId: 1, type: 'nav', data: null },
      { pageId: 1, data: null },
      { pageId: 1, type: 'NAV', data: 'str' },
    ]) {
      await expectError(await req('POST', '/api/icons', { body, cookie }), 400)
    }
  })
})

describe('PATCH /api/icons/move —— 分支三:落页面顶层', () => {
  it('同页纯重排:不校验容量,序 0..n-1 无空洞', async () => {
    const [page, first] = await navPage(3)
    const res = await req('PATCH', '/api/icons/move', { body: { id: first, toPageId: page, toIndex: 2 }, cookie })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { pageId: number; parentId: null; sortOrder: number }
    expect(json).toMatchObject({ pageId: page, parentId: null, sortOrder: 2 })
    expect(await topOrders(page)).toEqual([0, 1, 2])
  })

  it('toIndex 超界夹紧到末尾;跨页移动源页补洞', async () => {
    const [pageA, a0] = await navPage(2, 'A')
    const [pageB] = await navPage(2, 'B')
    const res = await req('PATCH', '/api/icons/move', { body: { id: a0, toPageId: pageB, toIndex: 99 }, cookie })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { sortOrder: number }).sortOrder).toBe(2) // 夹紧到 B 页末尾(原 2 个之后)
    expect(await topOrders(pageA)).toEqual([0]) // 源页补洞
    expect(await topOrders(pageB)).toEqual([0, 1, 2])
  })

  it('跨页容量校验:满页拒收(剩余 0 格)', async () => {
    const [fullPage] = await navPage(64)
    const res = await req('PATCH', '/api/icons/move', { body: { id: 1, toPageId: fullPage, toIndex: 0 }, cookie })
    await expectError(res, 409, '目标页面容量不足，剩余 0 格')
  })
})

describe('PATCH /api/icons/move —— 分支二:入组/组内重排(修正白名单④)', () => {
  it('入组(新进组)按 toIndex 插入并夹紧(Java 旧行为=恒落末尾,已修)', async () => {
    // 页内 4 个 NAV,merge [1st,2nd] 建组 → 组内 [a,b]
    const [page, a, b, c] = await (async () => {
      const [p, first] = await navPage(4)
      const rows = await db.selectFrom('icons').select('id').where('page_id', '=', p).orderBy('sort_order', 'asc').execute()
      return [p, first, rows[1]!.id, rows[2]!.id] as const
    })()
    const g = await mergeIcons(page, [a, b])
    expect(await memberOrder(g)).toEqual([[a, 0], [b, 1]])
    // positive:c 入组 toIndex 0 → 组内 [c,a,b](Java 会是 [a,b,c])
    const res = await req('PATCH', '/api/icons/move', { body: { id: c, toPageId: page, toIndex: 0, parentId: g }, cookie })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { parentId: number }).parentId).toBe(g)
    expect(await memberOrder(g)).toEqual([[c, 0], [a, 1], [b, 2]])
    // negative:超界夹紧(而非 400/500);c 移出后再入组 toIndex 99 → 落末尾
    await req('PATCH', '/api/icons/move', { body: { id: c, toPageId: page, toIndex: 0 }, cookie })
    await req('PATCH', '/api/icons/move', { body: { id: c, toPageId: page, toIndex: 99, parentId: g }, cookie })
    expect(await memberOrder(g)).toEqual([[a, 0], [b, 1], [c, 2]])
  })

  it('组内重排按 toIndex;移出致源组变空 → 空组不存活(组行自动删)', async () => {
    const [page, a, b] = await (async () => {
      const [p, first] = await navPage(3)
      const rows = await db.selectFrom('icons').select('id').where('page_id', '=', p).orderBy('sort_order', 'asc').execute()
      return [p, first, rows[1]!.id] as const
    })()
    const g = await mergeIcons(page, [a, b])
    // 组内重排:b 挪到 0
    await req('PATCH', '/api/icons/move', { body: { id: b, toPageId: page, toIndex: 0, parentId: g }, cookie })
    expect(await memberOrder(g)).toEqual([[b, 0], [a, 1]])
    // 移出 a(组里还剩 b,不删组)
    await req('PATCH', '/api/icons/move', { body: { id: a, toPageId: page, toIndex: 0 }, cookie })
    expect(await memberOrder(g)).toEqual([[b, 0]])
    expect(await db.selectFrom('icons').select('id').where('id', '=', g).execute()).toHaveLength(1)
    // 移出最后一个 b → 组变空,组行连带删除
    await req('PATCH', '/api/icons/move', { body: { id: b, toPageId: page, toIndex: 0 }, cookie })
    expect(await db.selectFrom('icons').select('id').where('id', '=', g).execute()).toHaveLength(0)
    expect(await topOrders(page)).toEqual([0, 1, 2]) // 排序无空洞(Java 此路径留洞,已修)
  })

  it('非 NAV 入组 409 / parentId 指向非组 409 / 目标组不存在 404 / 组行入组 409', async () => {
    const [page, a, b, c] = await (async () => {
      const [p, first] = await navPage(4)
      const rows = await db.selectFrom('icons').select('id').where('page_id', '=', p).orderBy('sort_order', 'asc').execute()
      return [p, first, rows[1]!.id, rows[2]!.id] as const
    })()
    const g = await mergeIcons(page, [a, b])
    await expectError(
      await req('PATCH', '/api/icons/move', { body: { id: 14, toPageId: 3, toIndex: 0, parentId: 14 }, cookie }),
      409, '只有网站链接图标可加入分组',
    )
    await expectError(
      await req('PATCH', '/api/icons/move', { body: { id: c, toPageId: page, toIndex: 0, parentId: c }, cookie }),
      409, 'parentId 指向的不是分组',
    )
    await expectError(
      await req('PATCH', '/api/icons/move', { body: { id: c, toPageId: page, toIndex: 0, parentId: 999 }, cookie }),
      404, '目标分组不存在',
    )
    await expectError(
      await req('PATCH', '/api/icons/move', { body: { id: g, toPageId: page, toIndex: 0, parentId: c }, cookie }),
      409, '分组不能嵌套入组',
    )
  })
})

describe('PATCH /api/icons/move —— 分支一:组行自身移动', () => {
  it('组行跨页:容量校验、成员 page_id 同步、组内序保留、源页补洞', async () => {
    const [pageA, a, b] = await (async () => {
      const [p, first] = await navPage(4)
      const rows = await db.selectFrom('icons').select('id').where('page_id', '=', p).orderBy('sort_order', 'asc').execute()
      return [p, first, rows[1]!.id] as const
    })()
    const [pageB] = await navPage(1, 'dst')
    const g = await mergeIcons(pageA, [a, b])
    const res = await req('PATCH', '/api/icons/move', { body: { id: g, toPageId: pageB, toIndex: 1 }, cookie })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { pageId: number }).pageId).toBe(pageB)
    // 成员同步 page_id,组内序保留
    for (const [mid] of await memberOrder(g)) {
      const row = await db.selectFrom('icons').select('page_id').where('id', '=', mid).executeTakeFirstOrThrow()
      expect(row.page_id).toBe(pageB)
    }
    expect(await memberOrder(g)).toEqual([[a, 0], [b, 1]])
    // 源页剩 c、d(补洞重排),目标页 2 行无空洞
    expect(await topOrders(pageA)).toEqual([0, 1])
    expect(await topOrders(pageB)).toEqual([0, 1])
  })
})

describe('POST /api/icons/merge', () => {
  it('happy:201 组行继承末位成员位置,data=新建分组,成员组内序 0..n-1,页面无空洞', async () => {
    const [page] = await navPage(4)
    const rows = await db.selectFrom('icons').select(['id', 'sort_order']).where('page_id', '=', page).orderBy('sort_order', 'asc').execute()
    const [a, b, c] = rows.map((r) => r.id) as [number, number, number]
    const res = await req('POST', '/api/icons/merge', { body: { pageId: page, memberIds: [a, b] }, cookie })
    expect(res.status).toBe(201)
    const json = (await res.json()) as { id: number; type: string; data: unknown; sortOrder: number; parentId: null }
    expect(json.type).toBe('GROUP')
    expect(json.data).toEqual({ name: '新建分组' })
    expect(json.parentId).toBeNull()
    // a 的位置消失重排后组行接管序列首位(= b 前移后的位置,照 Java 语义);页面 [组, c, d] 无空洞
    expect(json.sortOrder).toBe(0)
    expect(await memberOrder(json.id)).toEqual([[a, 0], [b, 1]])
    expect(await topOrders(page)).toEqual([0, 1, 2])
    expect((await db.selectFrom('icons').select('sort_order').where('id', '=', c).executeTakeFirstOrThrow()).sort_order).toBe(1)
  })

  it('409:<2 成员 / 成员重复 / 组行当成员 / 已入组成员 / 跨页成员;404 页面', async () => {
    const [page, a, b, c] = await (async () => {
      const [p, first] = await navPage(4)
      const rows = await db.selectFrom('icons').select('id').where('page_id', '=', p).orderBy('sort_order', 'asc').execute()
      return [p, first, rows[1]!.id, rows[2]!.id] as const
    })()
    await expectError(await req('POST', '/api/icons/merge', { body: { pageId: page, memberIds: [a] }, cookie }), 409, '合并成分组至少需要 2 个图标')
    await expectError(await req('POST', '/api/icons/merge', { body: { pageId: page, memberIds: [a, a] }, cookie }), 409, '成员存在重复')
    const g = await mergeIcons(page, [a, b])
    await expectError(await req('POST', '/api/icons/merge', { body: { pageId: page, memberIds: [c, g] }, cookie }), 409, '成员必须都是本页顶层的网站链接图标')
    await expectError(await req('POST', '/api/icons/merge', { body: { pageId: page, memberIds: [c, a] }, cookie }), 409, '成员必须都是本页顶层的网站链接图标')
    await expectError(await req('POST', '/api/icons/merge', { body: { pageId: page, memberIds: [c, 13] }, cookie }), 409, '成员必须都是本页顶层的网站链接图标')
    await expectError(await req('POST', '/api/icons/merge', { body: { pageId: 999, memberIds: [a, b] }, cookie }), 404, '页面不存在')
  })
})

describe('POST /api/icons/{id}/dissolve', () => {
  it('happy:200 无体,成员自组位置洒回本页顶层,组行删除,无空洞', async () => {
    const [page] = await navPage(4)
    const rows = await db.selectFrom('icons').select('id').where('page_id', '=', page).orderBy('sort_order', 'asc').execute()
    const [a, b, c, d] = rows.map((r) => r.id)
    const g = await mergeIcons(page, [a, b])
    const res = await req('POST', `/api/icons/${g}/dissolve`, { cookie })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('')
    expect(await db.selectFrom('icons').select('id').where('id', '=', g).execute()).toHaveLength(0)
    // 洒回顺序:[a, b, c, d](a、b 回到组原位置起连续)
    const seq = await db
      .selectFrom('icons').select(['id', 'sort_order', 'parent_id'])
      .where('page_id', '=', page).where('parent_id', 'is', null)
      .orderBy('sort_order', 'asc').execute()
    expect(seq.map((r) => r.id)).toEqual([a, b, c, d])
    expect(seq.map((r) => r.sort_order)).toEqual([0, 1, 2, 3])
  })

  it('409 满页容量(组行让 1 格不够);409 非分组;404', async () => {
    // 唯一可超容量的构造:满页组 + 跨页塞成员(入组不计目标页容量,Java 同)
    // 页B:64 NAV 满格 → merge 2 个 → 顶层 63(组+62 NAV);页A:1 NAV
    const [pageB] = await navPage(64, 'fullB')
    const rowsB = await db.selectFrom('icons').select('id').where('page_id', '=', pageB).orderBy('sort_order', 'asc').execute()
    const g = await mergeIcons(pageB, [rowsB[0]!.id, rowsB[1]!.id])
    const [pageA] = await navPage(1, 'srcA')
    const outsider = (await db.selectFrom('icons').select('id').where('page_id', '=', pageA).execute())[0]!.id
    const into = await req('PATCH', '/api/icons/move', { body: { id: outsider, toPageId: pageB, toIndex: 0, parentId: g }, cookie })
    expect(into.status).toBe(200)
    // dissolve:顶层 63 - 1 + 3 成员 = 65 > 64 → 409
    await expectError(
      await req('POST', `/api/icons/${g}/dissolve`, { cookie }),
      409, '页面容量不足，请先移出部分图标后再解散',
    )
    await expectError(await req('POST', `/api/icons/${rowsB[10]!.id}/dissolve`, { cookie }), 409, '该图标不是分组')
    await expectError(await req('POST', '/api/icons/999/dissolve', { cookie }), 404, '分组不存在')
  })
})

describe('PATCH /api/icons/{id}(修正白名单⑥:补参数校验)', () => {
  it('happy:data 覆盖 200 IconResponse', async () => {
    const res = await req('PATCH', '/api/icons/1', { body: { data: { name: 'GitHub', url: 'https://github.com/x' } }, cookie })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { id: number; data: Record<string, unknown> }
    expect(json.id).toBe(1)
    expect(json.data).toEqual({ name: 'GitHub', url: 'https://github.com/x' })
  })

  it('positive:data null = 部分更新不动(200 且 data 保持原值)', async () => {
    const before = await db.selectFrom('icons').select('data').where('id', '=', 1).executeTakeFirstOrThrow()
    const res = await req('PATCH', '/api/icons/1', { body: { data: null }, cookie })
    expect(res.status).toBe(200)
    const after = await db.selectFrom('icons').select('data').where('id', '=', 1).executeTakeFirstOrThrow()
    expect(after.data).toBe(before.data)
  })

  it('negative:畸形请求 400(data 非对象 / body 非对象 / 非 JSON)而非静默通过', async () => {
    await expectError(await req('PATCH', '/api/icons/1', { body: { data: 'str' }, cookie }), 400)
    await expectError(await req('PATCH', '/api/icons/1', { body: [1, 2], cookie }), 400)
    const bad = await req('PATCH', '/api/icons/1', { body: 'not-json', cookie })
    await expectError(bad, 400)
    await expectError(await req('PATCH', '/api/icons/999', { body: { data: null }, cookie }), 404, '图标不存在')
  })
})

describe('DELETE /api/icons/{id}', () => {
  it('happy:顶层删 204 + 页面补洞', async () => {
    const [page, first] = await navPage(3)
    const res = await req('DELETE', `/api/icons/${first}`, { cookie })
    expect(res.status).toBe(204)
    expect(await res.text()).toBe('')
    expect(await topOrders(page)).toEqual([0, 1])
  })

  it('409 组内还有成员;删末成员 → 空组连带删除 + 补洞', async () => {
    const [page] = await navPage(4)
    const rows = await db.selectFrom('icons').select('id').where('page_id', '=', page).orderBy('sort_order', 'asc').execute()
    const [a, b] = rows.map((r) => r.id)
    const g = await mergeIcons(page, [a, b])
    await expectError(await req('DELETE', `/api/icons/${g}`, { cookie }), 409, '分组内还有图标，请先解散分组')
    // 删 a → 组剩 b 不删;删 b → 组空连带删,页面重排
    expect((await req('DELETE', `/api/icons/${a}`, { cookie })).status).toBe(204)
    expect(await db.selectFrom('icons').select('id').where('id', '=', g).execute()).toHaveLength(1)
    expect((await req('DELETE', `/api/icons/${b}`, { cookie })).status).toBe(204)
    expect(await db.selectFrom('icons').select('id').where('id', '=', g).execute()).toHaveLength(0)
    expect(await topOrders(page)).toEqual([0, 1])
  })

  it('404 图标不存在', async () => {
    await expectError(await req('DELETE', '/api/icons/999', { cookie }), 404, '图标不存在')
  })
})
