import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { performance } from 'node:perf_hooks'
import * as mysql from 'mysql2/promise'
import { ETL_TABLES, type EtlSource, reconcile, runEtl } from './etl'

/**
 * 票 09 ETL CLI(切换日/演练,票 11/12 使用):mysql2 读 7 表 → SQLite 全量灌库 → 对账报告。
 * 用法:MYSQL_HOST/PORT/DB_USER/DB_PASSWORD/MYSQL_DATABASE 指向源库,
 *      `pnpm etl [目标库路径]`(缺省 data/newtab.db)。对账有差异 → exit 1。
 * mysql2 只进 devDependencies,不随生产镜像;dateStrings 让 DATETIME 以原样字符串直拷。
 */

async function main() {
  const target = process.argv[2] ?? process.env.DB_PATH ?? 'data/newtab.db'
  const started = performance.now()
  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST ?? '127.0.0.1',
    port: Number(process.env.MYSQL_PORT ?? 3306),
    user: process.env.DB_USER ?? 'newtab',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.MYSQL_DATABASE ?? 'newtab',
    dateStrings: true,
  })
  const source = {} as EtlSource
  for (const t of ETL_TABLES) {
    const [rows] = await conn.query(`SELECT ${t.columns.join(', ')} FROM ${t.name}`)
    source[t.name] = rows as Record<string, unknown>[]
  }
  await conn.end()

  mkdirSync(dirname(target), { recursive: true })
  const sqlite = new Database(target)
  sqlite.pragma('journal_mode = WAL')
  runEtl(sqlite, source)

  const report = reconcile(sqlite, source)
  for (const t of report.tables) {
    console.log(`${t.diffs.length === 0 && t.source === t.sqlite ? '✓' : '✗'} ${t.name}: ${t.sqlite}/${t.source} 行`)
    for (const d of t.diffs) console.log(`  ! ${d}`)
  }
  if (report.fkViolations.length > 0) console.log(`! foreign_key_check 违例 ${report.fkViolations.length} 行`, report.fkViolations)
  if (report.invalidJsonIcons.length > 0) console.log(`! icons.data 非法 JSON: id ${report.invalidJsonIcons.join(', ')}`)
  sqlite.close()
  console.log(`${report.ok ? '对账零差异 ✓' : '对账有差异 ✗'}(耗时 ${((performance.now() - started) / 1000).toFixed(1)}s)`)
  if (!report.ok) process.exitCode = 1
}

main()
