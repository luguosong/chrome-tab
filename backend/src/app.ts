import { Hono } from 'hono'
import { sql } from 'kysely'
import { meHandler, publicAuthRoutes, requireAuth, sessionMiddleware, type AuthEnv } from './auth'
import { changelogRoutes, type ChangelogService } from './changelog'
import type { Db } from './db'

/**
 * 应用工厂。测试 seam = app.request()(Hono 免端口,spec Testing Decisions 定版)。
 * /api 挂载顺序即拦截面(issues/04):session 解析 → login/logout 放行 → guard → 其余 /api/**
 * 须认证(未认证 401 空体);非 /api 放行;无 CORS(同源 Caddy)。
 * /debug/gc 仅供 RSS 实测(需 --expose-gc 启动)。
 */
export function createApp({
  db,
  cookieSecure = false,
  changelog,
}: {
  db: Db
  cookieSecure?: boolean
  changelog?: ChangelogService
}) {
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
  if (changelog) app.route('/', changelogRoutes(changelog))
  app.get('/api/me', meHandler)
  // 兜底 500(照 Java GlobalExceptionHandler):如 changelog 冷启动兜底刷新失败
  app.onError((err, c) => {
    console.error(err)
    return c.json({ status: 500, message: '服务器错误' }, 500)
  })
  return app
}
