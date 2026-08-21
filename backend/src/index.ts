import { serve } from '@hono/node-server'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { schedule } from 'node-cron'
import { createApp } from './app'
import { openDb } from './db'

const dbPath = process.env.DB_PATH ?? 'data/newtab.db'
mkdirSync(dirname(dbPath), { recursive: true })
const { sqlite, db } = openDb(dbPath)
const app = createApp({ db })

const port = Number(process.env.PORT ?? 8080)
serve({ fetch: app.fetch, port }, (info) => console.log(`backend listening on :${info.port}`))

// ponytail: 骨架期唯一 cron = 每日 WAL checkpoint 防文件增长;票 06/09 真实任务落位后归并
schedule('17 3 * * *', () => sqlite.pragma('wal_checkpoint(TRUNCATE)'))
