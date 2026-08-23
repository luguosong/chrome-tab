import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { sql } from 'kysely'
import { meHandler, publicAuthRoutes, requireAuth, sessionMiddleware, type AuthEnv } from './auth'
import { changelogRoutes, type ChangelogServices } from './changelog'
import { ConflictError } from './common'
import { configRoutes } from './config'
import type { Db } from './db'
import { iconRoutes } from './icons'
import { layoutRoutes } from './layout'
import { pageRoutes } from './pages'
import { createWallpaperHandler } from './wallpaper'
import { createSiteInfoHandler } from './siteInfo'
import { weatherRoutes, type WeatherConfig } from './weather'

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
  weather,
}: {
  db: Db
  cookieSecure?: boolean
  changelog?: ChangelogServices
  weather?: WeatherConfig
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
  app.use('/api/*', sessionMiddleware(db, cookieSecure))
  app.route('/', publicAuthRoutes(db, cookieSecure))
  app.use('/api/*', requireAuth())
  if (changelog) app.route('/', changelogRoutes(changelog))
  app.get('/api/me', meHandler)
  app.route('/', pageRoutes(db))
  app.route('/', iconRoutes(db))
  app.route('/', layoutRoutes(db))
  app.route('/', configRoutes(db))
  // weather 恒挂载:未配置 → requireConfigured 抛 → 500「服务器错误」(契约 §7,非 404)
  app.route('/', weatherRoutes(weather))
  app.get('/api/wallpaper', createWallpaperHandler())
  // 站点信息抓取(CONTEXT.md「站点信息」):新增/编辑表单自动填充用,/api/* 鉴权横切覆盖
  app.get('/api/site-info', createSiteInfoHandler())
  // 统一错误体 {status, message}(api-contract §0):业务/校验冲突按自带 status;
  // 未映射路径(含旧端点 /api/nav-links)404 资源不存在;兜底 500 服务器错误(留栈)。
  app.onError((err, c) => {
    if (err instanceof ConflictError) {
      return c.json({ status: err.status, message: err.message }, err.status as ContentfulStatusCode)
    }
    console.error(err)
    return c.json({ status: 500, message: '服务器错误' }, 500)
  })
  app.notFound((c) => c.json({ status: 404, message: '资源不存在' }, 404))
  return app
}
