import { serve } from '@hono/node-server'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { schedule } from 'node-cron'
import { createApp } from './app'
import { ChangelogService, prodChangelogDeps, startChangelogScheduler } from './changelog'
import { openDb } from './db'
import { bootstrap } from './seed'

const dbPath = process.env.DB_PATH ?? 'data/newtab.db'
mkdirSync(dirname(dbPath), { recursive: true })
const { sqlite, db } = openDb(dbPath)
// 空库首启 seed;users 空且缺 ADMIN_PASSWORD 时抛错 → 进程退出(照搬 DataBootstrap 语义)
await bootstrap(db, {
  username: process.env.ADMIN_USERNAME ?? 'admin',
  password: process.env.ADMIN_PASSWORD,
})
// cookie secure 照 Java prod profile:NODE_ENV=production 下默认 true,COOKIE_SECURE=false 可关(裸 IP HTTP 部署)
const cookieSecure =
  process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'false'
const changelog = new ChangelogService(db, prodChangelogDeps())
const app = createApp({ db, cookieSecure, changelog })

const port = Number(process.env.PORT ?? 8080)
serve({ fetch: app.fetch, port }, (info) => console.log(`backend listening on :${info.port}`))
// ADR-0017:启动先恢复快照再异步预热,此后每 6h 定时刷新
startChangelogScheduler(changelog)

// ponytail: 骨架期 cron = 每日 WAL checkpoint + 过期 session 物理清理(读路径惰性已失效,此处只回收行);票 06/09 真实任务落位后归并
schedule('17 3 * * *', async () => {
  sqlite.pragma('wal_checkpoint(TRUNCATE)')
  await db.deleteFrom('sessions').where('expires_at', '<=', new Date().toISOString()).execute()
})
