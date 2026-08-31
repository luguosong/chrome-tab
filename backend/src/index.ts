import { serve } from '@hono/node-server'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { schedule } from 'node-cron'
import { CHANGELOG_SOURCES, hasChangelogRaw } from 'chrome-tab-shared'
import { createApp } from './app'
import { dailyBackup } from './backup'
import { ChangelogService, prodChangelogDeps, startChangelogScheduler, type ChangelogServices } from './changelog'
import { openDb } from './db'
import { bootstrap } from './seed'
import { ModelTrackingService, prodModelDeps, startModelTrackingScheduler } from './modelTracking'
import { NewsService, prodNewsDeps, startNewsScheduler } from './news/news'
import { ServerMonService, prodServerMonDeps, startServerMonScheduler, type ServerMonMachine } from './servermon'
import { TrendingService, prodTrendingDeps, startTrendingScheduler } from './trending'
import { VideoUpdatesService, prodVideoDeps, startVideoUpdatesScheduler } from './videoUpdates'

const dbPath = resolve(process.env.DB_PATH ?? 'data/newtab.db')
mkdirSync(dirname(dbPath), { recursive: true })
// mimosa-ignore 单运维部署:DB_PATH 是运维自控配置,非攻击者可控输入(见 .mimosa/security-policy.json 排除项)
const { sqlite, db } = openDb(dbPath)
// 空库首启 seed;users 空且缺 ADMIN_PASSWORD 时抛错 → 进程退出(照搬 DataBootstrap 语义)
const adminUsername = process.env.ADMIN_USERNAME ?? 'admin'
// 用户名格式是账号不变量(\w,1–64),启动即校验——运维误配当场报错,不进库
if (!/^\w{1,64}$/.test(adminUsername)) throw new Error(`ADMIN_USERNAME 格式非法:${adminUsername}`)
// mimosa-ignore 单运维部署:ADMIN_*/env 为运维自控;Kysely 全参数化,无 SQL 拼接
await bootstrap(db, {
  username: adminUsername,
  password: process.env.ADMIN_PASSWORD,
})
// cookie secure 照 Java prod profile:NODE_ENV=production 下默认 true,COOKIE_SECURE=false 可关(裸 IP HTTP 部署)
const cookieSecure =
  process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'false'
// 每源一个 Service(ADR-0020):快照/预热/定时独立,译文表按块哈希跨源共享;
// 「有正文源」判别轴单点在 shared 的 hasChangelogRaw(ADR-0050,直取或合成皆算):
// 无原文源(两地址皆缺省,现无实例)译制窗口传 0——合成空块无可译内容
const changelog = Object.fromEntries(
  CHANGELOG_SOURCES.map((s) => [
    s.id,
    new ChangelogService(db, s.id, prodChangelogDeps(s.id), hasChangelogRaw(s) ? 5 : 0),
  ]),
) as ChangelogServices
// 和风天气(ADR-0009):Key/个人专用主机走环境变量、不入库;缺省未配置 → 端点 500
const videoUpdatesService = new VideoUpdatesService(db, prodVideoDeps())
// 模型追踪(CONTEXT.md「模型追踪」,issues/01):init 同步完成基线入档(本地写,毫秒级),
// 首轮取数异步进行——失败照陈旧口径降级,基线数据已保证 tile 即有内容
const modelTrackingService = new ModelTrackingService(db, prodModelDeps(), process.env.ARTIFICIALANALYSIS_API_KEY ?? '')
await modelTrackingService.init()
// 新闻(CONTEXT.md「新闻」,ADR-0027):匿名抓取无凭据,勾选与降级口径见 news.ts
const newsService = new NewsService(db, prodNewsDeps())
// GitHub 趋势(CONTEXT.md「GitHub 趋势」,ADR-0028):无凭据匿名抓取,榜单内存缓存
// 不落库;描述译文按哈希落 trending_translations 终身复用(ADR-0030)
const trendingService = new TrendingService(db, prodTrendingDeps())
// 服务器状态(CONTEXT.md「服务器状态」):exporter URL(含 token)经 env 注入,两键
// 均可缺省(本地 dev 无监控机 → 空清单,快照返回 [] 不炸)。两台均走 host-gateway
// (host.docker.internal):容器内 127.0.0.1 是容器自身——thinkpad 的 frp remotePort
// (10001)与 aliyun 的 exporter(7800)都监听在宿主命名空间;域名已加 NO_PROXY
// (误走 mihomo 代理必失败,同国内源事故口径)
const servermonMachines: ServerMonMachine[] = (
  [
    ['thinkpad', process.env.SERVERMON_THINKPAD_URL],
    ['aliyun', process.env.SERVERMON_ALIYUN_URL],
  ] as [string, string | undefined][]
)
  .filter(([, url]) => url && url.trim() !== '')
  .map(([machine, url]) => ({ machine, url: url! }))
const servermonService = new ServerMonService(db, prodServerMonDeps(), servermonMachines)
// mimosa-ignore 单运维部署:env 派生配置( key/cookieSecure 等)非攻击者可控;库写路径全参数化
const app = createApp({
  db,
  cookieSecure,
  changelog,
  weather: {
    apiKey: process.env.QWEATHER_API_KEY ?? '',
    apiHost: process.env.QWEATHER_API_HOST ?? '',
  },
  // 滴答清单「待办」(CONTEXT.md):API 口令 env 注入,不入前端
  dida: { token: process.env.DIDA365_TOKEN ?? '' },
  // 视频更新(CONTEXT.md「视频更新」):凭据 env 注入,两键均可缺省(降级见 videoUpdates.ts)
  videoUpdates: videoUpdatesService,
  modelTracking: modelTrackingService,
  // 新闻(CONTEXT.md「新闻」,ADR-0027):匿名抓取无凭据,勾选见 news.ts
  news: newsService,
  // GitHub 趋势(CONTEXT.md「GitHub 趋势」,ADR-0028):匿名抓取无凭据
  trending: trendingService,
  // 服务器状态(CONTEXT.md「服务器状态」):exporter 快照 + 采样曲线
  servers: servermonService,
})

const port = Number(process.env.PORT ?? 8080)
serve({ fetch: app.fetch, port }, (info) => console.log(`backend listening on :${info.port}`))
// ADR-0017:启动先恢复快照再异步预热,此后每 6h 定时刷新(逐源,ADR-0020)
startChangelogScheduler(Object.values(changelog))
// 视频更新 1h 轮询(spec:非整点错开整点请求高峰;库即真相,无启动预热步骤)
startVideoUpdatesScheduler(videoUpdatesService)
// 模型追踪 6h 轮询(研究 §6;失败保留库内档案并标记陈旧,下轮即重试)
startModelTrackingScheduler(modelTrackingService)
// 新闻 30min 轮询(ADR-0027;勾选源才轮询,失败 48 轮标 failing 自愈口径见 news.ts)
startNewsScheduler(newsService)
// GitHub 趋势 1h 保热默认组合(ADR-0028;启动即预热,其余组合按需现抓)
startTrendingScheduler(trendingService)
// 服务器状态 10min 采样(3-53/10 错开整点;启动即采样,重启不空窗)
startServerMonScheduler(servermonService)

// 每日 03:17(UTC):WAL checkpoint + 过期 session 清理 + VACUUM INTO 备份(票 09;恢复 = 拷回文件)
schedule('17 3 * * *', async () => {
  sqlite.pragma('wal_checkpoint(TRUNCATE)')
  await db.deleteFrom('sessions').where('expires_at', '<=', new Date().toISOString()).execute()
  // mimosa-ignore 单运维部署:BACKUP_DIR 为运维自控;backup.ts 另有边界拒收 + SQL 内转义
  dailyBackup(sqlite, resolve(process.env.BACKUP_DIR ?? 'data/backups'))
})
