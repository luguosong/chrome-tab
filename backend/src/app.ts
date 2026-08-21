import { Hono } from 'hono'
import { sql } from 'kysely'
import type { Db } from './db'

/**
 * 应用工厂。测试 seam = app.request()(Hono 免端口,spec Testing Decisions 定版);
 * 业务路由票 04+ 逐票挂载。/debug/gc 仅供 RSS 实测(需 --expose-gc 启动)。
 */
export function createApp({ db }: { db: Db }) {
  return new Hono()
    .get('/healthz', async (c) => {
      await sql`select 1`.execute(db)
      return c.json({ status: 'ok' })
    })
    .post('/debug/gc', (c) => {
      const gc = (globalThis as { gc?: () => void }).gc
      if (!gc) return c.json({ error: 'requires --expose-gc' }, 501)
      gc()
      gc()
      return c.json({ gc: 'done' })
    })
}
