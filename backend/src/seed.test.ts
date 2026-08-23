import { describe, expect, it } from 'vitest'
import { openDb } from './db'
import { verifyPassword } from './password'
import { bootstrap } from './seed'

// DataBootstrap 语义冻结(spec 票 04):users 空 → ADMIN_PASSWORD 建 admin(缺失启动报错);
// pages 空 → seed 3 页 26 图标 + config_version touch;非空全跳过;ADMIN_* 仅首启生效。

// 期望清单独立手抄自 prototype 原始数据(不 import seed 常量,防抄写错误漏网)
const NAV: [string, string][] = [
  ['GitHub', 'https://github.com'],
  ['谷歌', 'https://www.google.com'],
  ['StackOverflow', 'https://stackoverflow.com'],
  ['MDN', 'https://developer.mozilla.org'],
  ['知乎', 'https://www.zhihu.com'],
  ['掘金', 'https://juejin.cn'],
  ['V2EX', 'https://www.v2ex.com'],
  ['npm', 'https://www.npmjs.com'],
  ['React', 'https://react.dev'],
  ['Vue', 'https://vuejs.org'],
  ['B站', 'https://www.bilibili.com'],
  ['HN', 'https://news.ycombinator.com'],
]
const STOCKS: [string, string][] = [
  ['usAAPL', '苹果'], ['usMSFT', '微软'], ['usNVDA', '英伟达'], ['usTSLA', '特斯拉'],
  ['usGOOGL', '谷歌'], ['usDJI', '道指'], ['usIXIC', '纳指'], ['usINX', '标普500'],
  ['sh000001', '上证指数'], ['sz399001', '深证成指'], ['sz399006', '创业板指'],
  ['sh600519', '贵州茅台'], ['sz300750', '宁德时代'],
]

describe('空库首启 seed', () => {
  it('admin + 3 页 26 图标 + config_version touch,逐项对齐 DataBootstrap', async () => {
    const { db } = openDb(':memory:')
    await bootstrap(db, { username: 'admin', password: 'seed-pw' })

    const users = await db.selectFrom('users').selectAll().execute()
    expect(users).toHaveLength(1)
    expect(users[0]!.username).toBe('admin')
    expect(users[0]!.password).toMatch(/^\$2a\$/)
    expect(await verifyPassword('seed-pw', users[0]!.password)).toBe(true)
    expect(users[0]!.created_at).toBeTruthy()

    const pages = await db.selectFrom('pages').selectAll().orderBy('sort_order').execute()
    expect(pages.map((p) => [p.name, p.sort_order, p.user_id])).toEqual([
      ['快速导航', 0, 1],
      ['日志更新', 1, 1],
      ['行情', 2, 1],
    ])

    const [navPage, changelogPage, stockPage] = pages
    const icons = await db.selectFrom('icons').selectAll().execute()
    expect(icons).toHaveLength(26)

    const nav = icons.filter((i) => i.page_id === navPage!.id).sort((a, b) => a.sort_order - b.sort_order)
    expect(nav.map((i) => i.type)).toEqual(Array(12).fill('NAV'))
    expect(nav.map((i) => i.sort_order)).toEqual([...Array(12).keys()])
    expect(nav.map((i) => [JSON.parse(i.data!).name, JSON.parse(i.data!).url])).toEqual(NAV)
    expect(nav.every((i) => i.parent_id === null)).toBe(true)

    const changelog = icons.filter((i) => i.page_id === changelogPage!.id)
    expect(changelog).toHaveLength(1)
    expect(changelog[0]!.type).toBe('CHANGELOG')
    expect(JSON.parse(changelog[0]!.data!)).toEqual({ source: 'claude-code' })

    const stocks = icons.filter((i) => i.page_id === stockPage!.id).sort((a, b) => a.sort_order - b.sort_order)
    expect(stocks.map((i) => i.type)).toEqual(Array(13).fill('STOCK'))
    expect(stocks.map((i) => [JSON.parse(i.data!).symbol, JSON.parse(i.data!).name])).toEqual(STOCKS)

    const cv = await db.selectFrom('config_version').selectAll().execute()
    expect(cv).toHaveLength(1)
    expect(cv[0]!.updated_at).toBeTruthy()
  })

  it('二次启动不重复 seed,ADMIN_* 仅首启生效(改 env 密码不动库)', async () => {
    const { db } = openDb(':memory:')
    await bootstrap(db, { username: 'admin', password: 'first-pw' })
    await bootstrap(db, { username: 'admin', password: 'changed-pw' })

    const users = await db.selectFrom('users').selectAll().execute()
    expect(users).toHaveLength(1)
    expect(await verifyPassword('first-pw', users[0]!.password)).toBe(true)
    expect(await verifyPassword('changed-pw', users[0]!.password)).toBe(false)
    expect(await db.selectFrom('pages').selectAll().execute()).toHaveLength(3)
    expect(await db.selectFrom('icons').selectAll().execute()).toHaveLength(26)
  })

  it('断点续 seed:users 非空、pages 空 → 只补业务数据给现有用户,无需 ADMIN_PASSWORD', async () => {
    const { db } = openDb(':memory:')
    await db
      .insertInto('users')
      .values({ username: 'pre-existing', password: '$2a$10$x', created_at: new Date().toISOString() })
      .execute()
    await bootstrap(db, { username: 'admin' })

    expect(await db.selectFrom('users').selectAll().execute()).toHaveLength(1)
    const pages = await db.selectFrom('pages').selectAll().execute()
    expect(pages).toHaveLength(3)
    expect(pages.every((p) => p.user_id === 1 && p.name !== null)).toBe(true)
    expect(await db.selectFrom('icons').selectAll().execute()).toHaveLength(26)
  })

  it('空库且 ADMIN_PASSWORD 缺失/空白 → 抛错(启动失败)', async () => {
    for (const password of [undefined, '', '   ']) {
      const { db } = openDb(':memory:')
      await expect(bootstrap(db, { username: 'admin', password })).rejects.toThrow('ADMIN_PASSWORD')
    }
  })
})
