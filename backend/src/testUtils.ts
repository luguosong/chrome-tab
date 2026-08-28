import { expect } from 'vitest'
import { DEFAULT_CHANGELOG_SOURCE } from 'chrome-tab-shared'
import { createApp } from './app'
import type { ChangelogService, ChangelogServices } from './changelog'
import { openDb, type Db } from './db'
import type { NewsService } from './news/news'
import type { ServerMonService } from './servermon'
import { bootstrap } from './seed'

/**
 * 契约测试 fixture(spec Testing Decisions):内存 SQLite + seed 基线
 * (3 页 26 图标:12 NAV / 1 CHANGELOG / 13 STOCK),主 seam = app.request()。
 * 每测试文件独立实例,互不串污染;测试可直接用 db 造边角 fixture(满格页等)。
 * changelog/news 透传注入桩 service(假 fetch,零外呼)。
 */

/** 测试假上游 key:上游全是本文件/本进程内的 stub,仅记录外呼不校验取值,非真实凭据。
 *  集中一处声明,各测试文件引用,避免逐文件散落字面量。 */
export const STUB_UPSTREAM_KEY = 'stub-upstream-key'
export async function setupApp(
  changelog?: ChangelogService,
  newsFactory?: (db: Db) => NewsService,
  servers?: ServerMonService,
) {
  const { db } = openDb(':memory:')
  await bootstrap(db, { username: 'admin', password: 'admin-pw' })
  const app = createApp({
    db,
    // 计算键被推宽,断言回 map 类型;matt-skills 缺位时 pick 回落默认源,无碍
    changelog: (changelog && { [DEFAULT_CHANGELOG_SOURCE]: changelog }) as ChangelogServices | undefined,
    news: newsFactory?.(db),
    servers,
  })
  const login = async () => {
    const res = await app.request('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin-pw' }),
    })
    return res.headers.getSetCookie()[0]!.split(';')[0]!
  }
  /** 带登录态发请求;json 传 undefined 表示无 body(POST 也会发空 body) */
  const req = (method: string, path: string, opts: { body?: unknown; cookie?: string } = {}) =>
    app.request(path, {
      method,
      headers: {
        ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(opts.cookie ? { cookie: opts.cookie } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    })
  return { db, app, login, req }
}

/** 断言 4xx 错误体形状 {status, message} */
export async function expectError(res: Response, status: number, message?: string) {
  expect(res.status).toBe(status)
  const json = (await res.json()) as { status: number; message: string }
  expect(json.status).toBe(status)
  expect(typeof json.message).toBe('string')
  if (message !== undefined) expect(json.message).toBe(message)
}

/** 直插一页(测试造容量/组场景用,绕开 HTTP);返回 page id。 */
export async function insertPage(db: Db, userId = 1, name = 't'): Promise<number> {
  const { id } = await db
    .insertInto('pages')
    .values({ user_id: userId, name, sort_order: 999, created_at: new Date().toISOString() })
    .returning('id')
    .executeTakeFirstOrThrow()
  return id
}
