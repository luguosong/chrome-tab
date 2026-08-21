import Database from 'better-sqlite3'
import { Kysely, SqliteDialect } from 'kysely'

// ponytail: schema 类型票 03 落地后收紧为 Kysely<Database>
export type Db = Kysely<any>

/**
 * 打开 SQLite 并设方言要点(spec「存储与 schema」):WAL + 外键显式开启。
 * 测试 fixture 用 openDb(':memory:')。
 */
export function openDb(path: string) {
  const sqlite = new Database(path)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  return { sqlite, db: new Kysely<any>({ dialect: new SqliteDialect({ database: sqlite }) }) }
}
