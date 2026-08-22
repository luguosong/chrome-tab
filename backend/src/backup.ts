import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { Database as SqliteConnection } from 'better-sqlite3'

/**
 * 票 09 每日备份(research/03 §4):`VACUUM INTO` 在 live 库上安全产出一致单文件快照,
 * 禁止直接 cp 库文件(WAL 打开时可能拷出损坏副本)。恢复 = 停容器 → 拷回文件(删 -wal/-shm)→ 起容器。
 * 目标文件已存在会报错 → 文件名带 UTC 日期,当日重跑幂等跳过。
 */

const KEEP = 14
const NAME_RE = /^newtab-\d{4}-\d{2}-\d{2}\.db$/

export function dailyBackup(sqlite: SqliteConnection, dir: string) {
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `newtab-${new Date().toISOString().slice(0, 10)}.db`)
  if (!existsSync(file)) sqlite.exec(`VACUUM INTO '${file.replaceAll("'", "''")}'`)
  const files = readdirSync(dir).filter((f) => NAME_RE.test(f)).sort()
  for (const f of files.slice(0, Math.max(0, files.length - KEEP))) rmSync(join(dir, f))
}
