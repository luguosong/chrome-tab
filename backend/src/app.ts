import { Hono } from 'hono'
import { sql } from 'kysely'
import { meHandler, publicAuthRoutes, requireAuth, sessionMiddleware, type AuthEnv } from './auth'
import type { Db } from './db'

/**
 * 应用工厂。测试 seam = app.request()(Hono 免端口,spec Testing Decisions 定版)。
 * /api 挂载顺序即拦截面(issues/04):session 解析 → login/logout 放行 → guard → 其余 /api/**
 * 须认证(未认证 401 空体);非 /api 放行;无 CORS(同源 Caddy)。
 * /debug/gc 仅供 RSS 实测(需 --expose-gc 启动)。
 */
export function createApp({ db, cookieSecure = false }: { db: Db; cookieSecure?: boolean }) {
  const app = new Hono<AuthEnv>()
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
  app.use('/api/*', sessionMiddleware(db))
  app.route('/', publicAuthRoutes(db, cookieSecure))
  app.use('/api/*', requireAuth())
  app.get('/api/me', meHandler)
  return app
}
