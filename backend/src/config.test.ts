import { beforeAll, describe, expect, it } from 'vitest'
import { expectError, setupApp } from './testUtils'

// api-contract §2/§3 + ADR-0006。fixture:seed 3 页 26 图标(页1=12NAV/页2=1CHANGELOG/页3=13STOCK),
// 无 layout 行 → defaults。GET 排序承诺:pages (sortOrder,id)、icons (pageId,sortOrder,id)。

let req: Awaited<ReturnType<typeof setupApp>>['req']
let cookie: string

beforeAll(async () => {
  const s = await setupApp()
  req = s.req
  cookie = await s.login()
})

describe('GET /api/config', () => {
  it('happy:seed 基线聚合——形状、大写枚举、排序承诺、layoutSettings 默认值、updatedAt 非 null', async () => {
    const res = await req('GET', '/api/config', { cookie })
    expect(res.status).toBe(200)
    const json = (await res.json()) as {
      pages: Array<{ id: number; name: string; sortOrder: number }>
      icons: Array<{ id: number; pageId: number; parentId: number | null; type: string; sortOrder: number; data: unknown }>
      layoutSettings: Record<string, unknown>
      updatedAt: string | null
    }
    expect(json.pages).toEqual([
      { id: 1, name: '快速导航', sortOrder: 0 },
      { id: 2, name: '日志更新', sortOrder: 1 },
      { id: 3, name: '行情', sortOrder: 2 },
    ])
    expect(json.icons).toHaveLength(26)
    // 排序承诺:icons 按 (pageId, sortOrder, id) 升序
    const keys = json.icons.map((i) => [i.pageId, i.sortOrder, i.id] as const)
    const sorted = [...keys].sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2])
    expect(keys).toEqual(sorted)
    // 大写枚举 wire;data 形态抽查
    expect(json.icons.filter((i) => i.type === 'NAV')).toHaveLength(12)
    expect(json.icons.find((i) => i.type === 'CHANGELOG')!.data).toEqual({ source: 'claude-code' })
    expect(json.icons.find((i) => i.type === 'NAV')!.data).toEqual({ name: 'GitHub', url: 'https://github.com' })
    expect(json.icons.filter((i) => i.type === 'STOCK')).toHaveLength(13)
    // 无行 → defaults()(14 字段全量)
    expect(json.layoutSettings).toEqual({
      gridWidth: 1024, gridGap: 8, gridGapY: 8, iconScale: 1.5, panelFog: 36,
      searchBarWidth: 576, searchBarVisible: true, searchEngine: 'google',
      clockVisible: true, clockFont: 48, clock24h: true,
      labelVisible: true, labelSize: 12, labelColor: '#ffffff',
    })
    expect(typeof json.updatedAt).toBe('string')
    // 负向字段(test-align-map):顶层恰 4 字段,无旧 setting/navLinks;icon 无 ADR-0016 已删的 size
    expect(Object.keys(json).sort()).toEqual(['icons', 'layoutSettings', 'pages', 'updatedAt'])
    for (const i of json.icons) {
      expect(Object.keys(i).sort()).toEqual(['data', 'id', 'pageId', 'parentId', 'sortOrder', 'type'])
    }
  })

  it('未认证 401 空体', async () => {
    const res = await req('GET', '/api/config')
    expect(res.status).toBe(401)
    expect(await res.text()).toBe('')
  })
})

describe('PUT /api/layout-settings', () => {
  it('happy:全量落库回读(布尔 0/1 → true/false),bump 版本', async () => {
    const before = (await (await req('GET', '/api/config', { cookie })).json()) as { updatedAt: string }
    await new Promise((r) => setTimeout(r, 5))
    const res = await req('PUT', '/api/layout-settings', {
      body: {
        gridWidth: 1280, gridGap: 12, gridGapY: 16, iconScale: 1.75, panelFog: 20,
        searchBarWidth: 800, searchBarVisible: false, searchEngine: 'bing',
        clockVisible: false, clockFont: 60, clock24h: false,
        labelVisible: false, labelSize: 14, labelColor: '#aAbBcC',
      },
      cookie,
    })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      gridWidth: 1280, gridGap: 12, gridGapY: 16, iconScale: 1.75, panelFog: 20,
      searchBarWidth: 800, searchBarVisible: false, searchEngine: 'bing',
      clockVisible: false, clockFont: 60, clock24h: false,
      labelVisible: false, labelSize: 14, labelColor: '#aAbBcC',
    })
    const after = (await (await req('GET', '/api/config', { cookie })).json()) as { updatedAt: string; layoutSettings: unknown }
    expect(after.updatedAt > before.updatedAt).toBe(true)
    expect((after.layoutSettings as { gridWidth: number }).gridWidth).toBe(1280)
  })

  it('宽松请求:只带旧三字段成功,缺省补默认(双向兼容)', async () => {
    const res = await req('PUT', '/api/layout-settings', { body: { gridWidth: 800, gridGap: 4, iconScale: 1.0 }, cookie })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      gridWidth: 800, gridGap: 4, gridGapY: 8, iconScale: 1.0, panelFog: 36,
      searchBarWidth: 576, searchBarVisible: true, searchEngine: 'google',
      clockVisible: true, clockFont: 48, clock24h: true,
      labelVisible: true, labelSize: 12, labelColor: '#ffffff',
    })
  })

  it('400:必填缺失/超范围/非法枚举/坏色值', async () => {
    for (const body of [
      { gridGap: 8, iconScale: 1.5 },                          // 缺 gridWidth
      { gridWidth: 600, gridGap: 8, iconScale: 1.5 },          // 低于 640
      { gridWidth: 1024, gridGap: 30, iconScale: 1.5 },        // gap 超 24
      { gridWidth: 1024, gridGap: 8, iconScale: 2.5 },         // scale 超 2.0
      { gridWidth: 1024, gridGap: 8, iconScale: 1.5, gridGapY: 40 },      // 超 32
      { gridWidth: 1024, gridGap: 8, iconScale: 1.5, clockFont: 80 },     // 超 72
      { gridWidth: 1024, gridGap: 8, iconScale: 1.5, searchEngine: 'duckduckgo' },
      { gridWidth: 1024, gridGap: 8, iconScale: 1.5, labelColor: '#fff' },
      { gridWidth: 'x', gridGap: 8, iconScale: 1.5 },
    ]) {
      await expectError(await req('PUT', '/api/layout-settings', { body, cookie }), 400)
    }
  })
})

describe('PUT /api/config(全量替换)', () => {
  /** 最小合法 blob:2 页 3 图标(含组),客户端 id 用大数模拟离线临时 id */
  const blob = () => ({
    pages: [
      { id: 9001, name: '甲', sortOrder: 0 },
      { id: 9002, name: '乙', sortOrder: 1 },
    ],
    icons: [
      { id: 9101, pageId: 9001, parentId: null, type: 'NAV', sortOrder: 0, data: { name: 'A', url: 'https://a' } },
      { id: 9102, pageId: 9001, parentId: null, type: 'NAV', sortOrder: 1, data: { name: 'B', url: 'https://b' } },
      { id: 9103, pageId: 9001, parentId: null, type: 'GROUP', sortOrder: 2, data: { name: '新建分组' } },
      { id: 9104, pageId: 9001, parentId: 9103, type: 'NAV', sortOrder: 0, data: { name: 'C', url: 'https://c' } },
      { id: 9105, pageId: 9002, parentId: null, type: 'CHANGELOG', sortOrder: 0, data: null },
    ],
  })

  it('happy:全量替换 + 服务端重分配全部 id + parentId 重定向 + 回读聚合', async () => {
    const res = await req('PUT', '/api/config', { body: blob(), cookie })
    expect(res.status).toBe(200)
    const json = (await res.json()) as {
      pages: Array<{ id: number; name: string; sortOrder: number }>
      icons: Array<{ id: number; pageId: number; parentId: number | null; type: string; sortOrder: number }>
      updatedAt: string | null
    }
    // id 全量重分配:blob 内 9001/9101 等临时 id 不复现
    expect(json.pages.map((p) => p.id)).not.toContain(9001)
    expect(json.icons.map((i) => i.id)).not.toContain(9101)
    expect(json.pages.map((p) => p.name)).toEqual(['甲', '乙'])
    // parentId 经映射重定向到新组行 id
    const group = json.icons.find((i) => i.type === 'GROUP')!
    const member = json.icons.find((i) => i.type === 'NAV' && i.parentId !== null)!
    expect(member.parentId).toBe(group.id)
    expect(member.pageId).toBe(group.pageId)
    // 旧数据彻底清除(seed 26 图标不复现)
    expect(json.icons).toHaveLength(5)
    expect(typeof json.updatedAt).toBe('string')
  })

  it('layoutSettings null = 保留现有布局行(替换不动 layout)', async () => {
    await req('PUT', '/api/layout-settings', { body: { gridWidth: 640, gridGap: 0, iconScale: 0.75 }, cookie })
    const res = await req('PUT', '/api/config', { body: { ...blob(), layoutSettings: null }, cookie })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { layoutSettings: { gridWidth: number; iconScale: number } }
    expect(json.layoutSettings.gridWidth).toBe(640)
    expect(json.layoutSettings.iconScale).toBe(0.75)
  })

  it('layoutSettings 随 blob 覆盖', async () => {
    const res = await req('PUT', '/api/config', {
      body: { ...blob(), layoutSettings: { gridWidth: 1536, gridGap: 24, iconScale: 2.0 } },
      cookie,
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { layoutSettings: { gridWidth: number; labelSize: number } }
    expect(json.layoutSettings.gridWidth).toBe(1536)
    expect(json.layoutSettings.labelSize).toBe(12) // 嵌套 layout 缺省补默认
  })

  it('结构 400:pages 缺失/空、icons 缺失、name 空超长、type 非法、缺 id/sortOrder', async () => {
    const base = blob()
    for (const body of [
      { icons: [] },
      { pages: [], icons: [] },
      { ...base, pages: [{ id: 1, name: '  ', sortOrder: 0 }] },
      { ...base, pages: [{ id: 1, name: 'x'.repeat(65), sortOrder: 0 }] },
      { ...base, icons: [{ id: 1, pageId: 9001, parentId: null, type: 'nav', sortOrder: 0, data: null }] },
      { ...base, icons: [{ pageId: 9001, parentId: null, type: 'NAV', sortOrder: 0, data: null }] },
      { ...base, icons: [{ id: 1, pageId: 9001, parentId: null, type: 'NAV', data: null }] },
    ]) {
      await expectError(await req('PUT', '/api/config', { body, cookie }), 400)
    }
    await expectError(await req('PUT', '/api/config', { body: 'not-json', cookie }), 400)
  })

  it('业务 409 矩阵:容量/孤儿 parentId/组嵌套/非 NAV 成员/跨页/空组(消息逐字)', async () => {
    const icon = (over: Record<string, unknown>): Record<string, unknown> =>
      ({ id: 9199, pageId: 9001, parentId: null, type: 'NAV', sortOrder: 9, data: null, ...over })
    // 容量:65 个顶层(仅 1 页)
    const full = { pages: [{ id: 9001, name: '甲', sortOrder: 0 }], icons: Array.from({ length: 65 }, (_, i) => icon({ id: 9200 + i, sortOrder: i })) }
    await expectError(await req('PUT', '/api/config', { body: full, cookie }), 409, '页面(blob 内 9001)容量超过 64 格')
    // CHANGELOG 非单例(ADR-0020):两实例各绑一源,合法
    {
      const res = await req('PUT', '/api/config', {
        body: { pages: [{ id: 9001, name: '甲', sortOrder: 0 }], icons: [icon({ id: 1, type: 'CHANGELOG', data: { source: 'claude-code' } }), icon({ id: 2, type: 'CHANGELOG', data: { source: 'matt-skills' } })] },
        cookie,
      })
      expect(res.status).toBe(200)
    }
    // id 重复
    await expectError(
      await req('PUT', '/api/config', {
        body: { pages: [{ id: 9001, name: '甲', sortOrder: 0 }], icons: [icon({ id: 7 }), icon({ id: 7 })] },
        cookie,
      }),
      409, 'icons[1] 的 id 重复:7',
    )
    // 孤儿 pageId
    await expectError(
      await req('PUT', '/api/config', { body: { ...blob(), icons: [...blob().icons, icon({ id: 9199, pageId: 9999 })] }, cookie }),
      409, 'icons[5] 引用了不存在的页面:9999',
    )
    // 孤儿 parentId
    await expectError(
      await req('PUT', '/api/config', { body: { ...blob(), icons: [...blob().icons, icon({ id: 9199, parentId: 8888 })] }, cookie }),
      409, 'icons[5] 引用了不存在的分组:8888',
    )
    // parentId 指向非组
    await expectError(
      await req('PUT', '/api/config', { body: { ...blob(), icons: [...blob().icons, icon({ id: 9199, parentId: 9101 })] }, cookie }),
      409, 'icons[5] 的 parentId 指向的不是分组',
    )
    // 组行自身带 parentId(嵌套):成员行在前,指向「带 parent 的组」→ 校验其 parent.parentId
    await expectError(
      await req('PUT', '/api/config', {
        body: {
          ...blob(),
          icons: [...blob().icons, icon({ id: 9199, parentId: 9198 }), icon({ id: 9198, type: 'GROUP', parentId: 9103 })],
        },
        cookie,
      }),
      409, '分组不能嵌套(组行自身带 parentId)',
    )
    // 非 NAV 成员(GROUP 行带 parentId 同样先以「非 NAV 成员」命中)
    await expectError(
      await req('PUT', '/api/config', { body: { ...blob(), icons: [...blob().icons, icon({ id: 9199, type: 'STOCK', parentId: 9103 })] }, cookie }),
      409, 'icons[5] 只有网站链接可以作为分组成员',
    )
    await expectError(
      await req('PUT', '/api/config', { body: { ...blob(), icons: [...blob().icons, icon({ id: 9199, type: 'GROUP', parentId: 9103 })] }, cookie }),
      409, 'icons[5] 只有网站链接可以作为分组成员',
    )
    // 成员跨页
    await expectError(
      await req('PUT', '/api/config', { body: { ...blob(), icons: [...blob().icons, icon({ id: 9199, parentId: 9103, pageId: 9002 })] }, cookie }),
      409, 'icons[5] 分组成员必须与分组同页',
    )
    // 空组
    await expectError(
      await req('PUT', '/api/config', {
        body: { pages: [{ id: 9001, name: '甲', sortOrder: 0 }], icons: [icon({ id: 9301, type: 'GROUP' })] },
        cookie,
      }),
      409, '分组(blob 内 9301)没有成员,空组不被接受',
    )
  })

  it('409 单例类型出现多次(blob 内两份 AIHOT,全局仅一个实例)', async () => {
    const body = {
      ...blob(),
      icons: [
        ...blob().icons,
        { id: 9106, pageId: 9002, parentId: null, type: 'AIHOT', sortOrder: 1, data: null },
        { id: 9107, pageId: 9002, parentId: null, type: 'AIHOT', sortOrder: 2, data: null },
      ],
    }
    await expectError(await req('PUT', '/api/config', { body, cookie }), 409, 'icons[6] 单例类型 AIHOT 出现多次，全局仅一个实例')
  })

  it('失败写(409)后数据原样保留、版本不前进(原子性)', async () => {
    await req('PUT', '/api/config', { body: blob(), cookie })
    const before = (await (await req('GET', '/api/config', { cookie })).json()) as { pages: unknown[]; updatedAt: string }
    await expectError(
      await req('PUT', '/api/config', { body: { pages: [{ id: 1, name: 'x', sortOrder: 0 }], icons: [icon404()] }, cookie }),
      409,
    )
    const after = (await (await req('GET', '/api/config', { cookie })).json()) as { pages: unknown[]; updatedAt: string }
    expect(after.pages).toEqual(before.pages)
    expect(after.updatedAt).toBe(before.updatedAt)
    function icon404() {
      return { id: 1, pageId: 999, parentId: null, type: 'NAV', sortOrder: 0, data: null }
    }
  })
})
