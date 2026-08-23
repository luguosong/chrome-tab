import type { Database as SqliteConnection } from 'better-sqlite3'
import { migrate } from './schema'

/**
 * 票 09:MySQL → SQLite 全量 ETL + 对账(research/03 §3)。
 * - 只做全量重跑:清空 7 张表再灌入,幂等、无残留(sessions 不迁但同清,防悬挂引用);
 *   不写任何增量同步(spec Out of Scope)。
 * - 列清单对齐 schema.ts 7 张平移表与 MySQL 侧最终形态(V1~V11 压平;
 *   layout_settings.updated_at 无对应物不迁);schema 加列须同步改这里与 etl.test fixture。
 * - 时间戳字符串逐字节原样拷贝(不解析不转时区)——顺序语义天然保留(research/03 时区注意)。
 * - ETL 期间关外键(清表/灌入不受顺序约束),结束后回 ON(失败也还,try/finally)
 *   并以 foreign_key_check 兜底。
 */

export const ETL_TABLES = [
  { name: 'users', pk: 'id', columns: ['id', 'username', 'password', 'created_at'] },
  { name: 'pages', pk: 'id', columns: ['id', 'user_id', 'name', 'sort_order', 'created_at'] },
  { name: 'icons', pk: 'id', columns: ['id', 'user_id', 'page_id', 'parent_id', 'type', 'sort_order', 'data', 'created_at'] },
  {
    name: 'layout_settings',
    pk: 'user_id',
    columns: ['user_id', 'grid_width', 'grid_gap', 'grid_gap_y', 'icon_scale', 'panel_fog', 'search_bar_width', 'search_bar_visible', 'search_engine', 'clock_visible', 'clock_font', 'clock_24h', 'label_visible', 'label_size', 'label_color'],
  },
  { name: 'config_version', pk: 'user_id', columns: ['user_id', 'updated_at'] },
  { name: 'changelog_translations', pk: 'block_hash', columns: ['block_hash', 'translated', 'created_at'] },
  // changelog_snapshot 不迁(ADR-0020 弃用):快照是可重建缓存,新表按 source 分键、旧单行无对应形态
] as const

export type EtlTableName = (typeof ETL_TABLES)[number]['name']
/** 行集 = mysql2 dateStrings:true 的输出形态(每表全行、列名与 SQLite 一致) */
export type EtlSource = { [T in EtlTableName]: Record<string, unknown>[] }

/** 全量重跑:建表(幂等)→ 清空全部表 → 事务灌入 → 外键回 ON。失败抛错、库保持原样(事务回滚)。 */
export function runEtl(sqlite: SqliteConnection, source: EtlSource) {
  migrate(sqlite)
  sqlite.pragma('foreign_keys = OFF')
  try {
    sqlite.transaction(() => {
      for (const t of ETL_TABLES) sqlite.exec(`DELETE FROM ${t.name}`)
      sqlite.exec('DELETE FROM sessions')
      for (const t of ETL_TABLES) {
        const stmt = sqlite.prepare(
          `INSERT INTO ${t.name} (${t.columns.join(', ')}) VALUES (${t.columns.map(() => '?').join(', ')})`,
        )
        for (const row of source[t.name]) stmt.run(...t.columns.map((c) => row[c] ?? null))
      }
    })()
  } finally {
    sqlite.pragma('foreign_keys = ON')
  }
}

export interface ReconcileTableReport {
  name: EtlTableName
  source: number
  sqlite: number
  diffs: string[]
}

export interface ReconcileReport {
  ok: boolean
  tables: ReconcileTableReport[]
  /** PRAGMA foreign_key_check 违例行(空 = 完好) */
  fkViolations: unknown[]
  /** icons.data 非法 JSON 的 id(合法 JSON 或 NULL 不列) */
  invalidJsonIcons: number[]
}

/**
 * 对账报告(数据迁移验证载体):行数逐表比对 + 全行逐字段比对(按 pk 对齐,1 MB 级数据全比不贵)
 * + 外键完好 + icons.data 全量 JSON.parse。零差异 → ok。
 */
export function reconcile(sqlite: SqliteConnection, source: EtlSource): ReconcileReport {
  const tables = ETL_TABLES.map((t) => {
    const diffs: string[] = []
    const src = new Map(source[t.name].map((r) => [String(r[t.pk]), r]))
    const rows = sqlite
      .prepare(`SELECT ${t.columns.join(', ')} FROM ${t.name}`)
      .all() as Record<string, unknown>[]
    const dst = new Map(rows.map((r) => [String(r[t.pk]), r]))
    for (const [pk, srcRow] of src) {
      const dstRow = dst.get(pk)
      if (!dstRow) {
        diffs.push(`${t.name}#${pk}: missing in sqlite`)
        continue
      }
      for (const col of t.columns) {
        if (srcRow[col] !== dstRow[col]) diffs.push(`${t.name}#${pk}.${col}: ${show(srcRow[col])} != ${show(dstRow[col])}`)
      }
    }
    for (const pk of dst.keys()) if (!src.has(pk)) diffs.push(`${t.name}#${pk}: extra in sqlite`)
    return { name: t.name, source: src.size, sqlite: dst.size, diffs }
  })
  const fkViolations = sqlite.pragma('foreign_key_check') as unknown[]
  const invalidJsonIcons = (
    sqlite.prepare('SELECT id, data FROM icons WHERE data IS NOT NULL').all() as { id: number; data: string }[]
  )
    .filter((r) => {
      try {
        JSON.parse(r.data)
        return false
      } catch {
        return true
      }
    })
    .map((r) => r.id)
  const ok = tables.every((t) => t.diffs.length === 0) && fkViolations.length === 0 && invalidJsonIcons.length === 0
  return { ok, tables, fkViolations, invalidJsonIcons }
}

function show(v: unknown): string {
  const s = typeof v === 'string' ? JSON.stringify(v) : String(v)
  return s.length > 60 ? `${s.slice(0, 57)}...` : s
}
