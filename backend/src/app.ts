import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { sql } from 'kysely'
import { aihotRoutes } from './aihot'
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
import { didaRoutes, type DidaConfig } from './dida'
import { modelTrackingRoutes, type ModelTrackingService } from './modelTracking'
import { newsRoutes, type NewsService } from './news/news'
import { trendingRoutes, type TrendingService } from './trending'
import { videoUpdatesRoutes, type VideoUpdatesService } from './videoUpdates'
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
  dida,
  videoUpdates,
  modelTracking,
  news,
  trending,
}: {
  db: Db
  cookieSecure?: boolean
  changelog?: ChangelogServices
  weather?: WeatherConfig
  dida?: DidaConfig
  videoUpdates?: VideoUpdatesService
  modelTracking?: ModelTrackingService
  news?: NewsService
  trending?: TrendingService
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
  // AIHOT 热点代理(单例图标「AI 热点」):无配置,失败降级见 aihot.ts
  app.route('/', aihotRoutes())
  // 滴答待办代理(单例图标「待办」,首个可写类型):未配置口令 → 400,降级见 dida.ts
  app.route('/', didaRoutes(dida))
  // 视频更新(单例图标「视频更新」):博主/视频持久化 + 1h 轮询(ADR-0023/0024),凭据可缺省降级
  if (videoUpdates) app.route('/', videoUpdatesRoutes(videoUpdates))
  // 模型追踪(单例图标「模型追踪」,issues/01):全局共享持久档案 + 6h 轮询(ADR-0025)
  if (modelTracking) app.route('/', modelTrackingRoutes(modelTracking))
  // 新闻(单例图标「新闻」,ADR-0027):15 内置源、账号级勾选、30min 轮询预取落库
  if (news) app.route('/', newsRoutes(news))
  // GitHub 趋势(单例图标「GitHub 趋势」,ADR-0028):默认组合 cron 保热、其余组合按需现抓(内存缓存)
  if (trending) app.route('/', trendingRoutes(trending))
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
