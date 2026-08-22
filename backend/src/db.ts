import Database from 'better-sqlite3'
import { Kysely, SqliteDialect } from 'kysely'
import { migrate, type SchemaDatabase } from './schema'

export type Db = Kysely<SchemaDatabase>

/**
 * 打开 SQLite 并设方言要点(spec「存储与 schema」):WAL + 外键显式开启 + 建表(幂等)。
 * 测试 fixture 用 openDb(':memory:')。
 */
export function openDb(path: string) {
  const sqlite = new Database(path)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  migrate(sqlite)
  return { sqlite, db: new Kysely<SchemaDatabase>({ dialect: new SqliteDialect({ database: sqlite }) }) }
}
