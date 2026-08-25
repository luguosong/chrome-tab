import Database from 'better-sqlite3'
import type { Database as DatabaseType } from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { openDb } from './db'
import { migrate } from './schema'

// 结构期望 = research/03 建表骨架 + spec 的 sessions 表。
// 每列:[name, type, notnull, dflt_value, pk]
// notnull 怪癖:INTEGER PRIMARY KEY(rowid 别名)隐式非空但 PRAGMA 报 0——
// 因此 TEXT 主键必须显式 NOT NULL(research 差异 #10),见 sessions/changelog_translations。
type Col = [string, string, 0 | 1, string | null, number]

const USERS: Col[] = [
  ['id', 'INTEGER', 0, null, 1],
  ['username', 'TEXT', 1, null, 0],
  ['password', 'TEXT', 1, null, 0],
  ['created_at', 'TEXT', 1, null, 0],
]
const PAGES: Col[] = [
  ['id', 'INTEGER', 0, null, 1],
  ['user_id', 'INTEGER', 1, null, 0],
  ['name', 'TEXT', 1, null, 0],
  ['sort_order', 'INTEGER', 1, '0', 0],
  ['created_at', 'TEXT', 1, null, 0],
]
const ICONS: Col[] = [
  ['id', 'INTEGER', 0, null, 1],
  ['user_id', 'INTEGER', 1, null, 0],
  ['page_id', 'INTEGER', 1, null, 0],
  ['parent_id', 'INTEGER', 0, null, 0],
  ['type', 'TEXT', 1, null, 0],
  ['sort_order', 'INTEGER', 1, '0', 0],
  ['data', 'TEXT', 0, null, 0],
  ['created_at', 'TEXT', 1, null, 0],
]
const LAYOUT_SETTINGS: Col[] = [
  ['user_id', 'INTEGER', 0, null, 1],
  ['grid_width', 'INTEGER', 1, null, 0],
  ['grid_gap', 'INTEGER', 1, null, 0],
  ['grid_gap_y', 'INTEGER', 1, '8', 0],
  ['icon_scale', 'REAL', 1, null, 0],
  ['panel_fog', 'INTEGER', 1, '36', 0],
  ['search_bar_width', 'INTEGER', 1, '576', 0],
  ['search_bar_visible', 'INTEGER', 1, '1', 0],
  ['search_engine', 'TEXT', 1, "'google'", 0],
  ['clock_visible', 'INTEGER', 1, '1', 0],
  ['clock_font', 'INTEGER', 1, '48', 0],
  ['clock_24h', 'INTEGER', 1, '1', 0],
  ['label_visible', 'INTEGER', 1, '1', 0],
  ['label_size', 'INTEGER', 1, '12', 0],
  ['label_color', 'TEXT', 1, "'#ffffff'", 0],
  ['important_dates', 'TEXT', 0, null, 0],
]
const CONFIG_VERSION: Col[] = [
  ['user_id', 'INTEGER', 0, null, 1],
  ['updated_at', 'TEXT', 1, null, 0],
]
const CHANGELOG_TRANSLATIONS: Col[] = [
  ['block_hash', 'TEXT', 1, null, 1],
  ['translated', 'TEXT', 1, null, 0],
  ['created_at', 'TEXT', 1, null, 0],
]
const CHANGELOG_SNAPSHOTS: Col[] = [
  ['source', 'TEXT', 1, null, 1],
  ['raw_markdown', 'TEXT', 1, null, 0],
  ['released_at', 'TEXT', 0, null, 0],
  ['fetched_at', 'TEXT', 1, null, 0],
]
const SESSIONS: Col[] = [
  ['session_id', 'TEXT', 1, null, 1],
  ['user_id', 'INTEGER', 1, null, 0],
  ['expires_at', 'TEXT', 1, null, 0],
]
const VIDEO_CATEGORIES: Col[] = [
  ['id', 'INTEGER', 0, null, 1],
  ['user_id', 'INTEGER', 1, null, 0],
  ['name', 'TEXT', 1, null, 0],
  ['sort_order', 'INTEGER', 1, '0', 0],
  ['created_at', 'TEXT', 1, null, 0],
]
const VIDEO_BLOGGERS: Col[] = [
  ['id', 'INTEGER', 0, null, 1],
  ['user_id', 'INTEGER', 1, null, 0],
  ['platform', 'TEXT', 1, null, 0],
  ['platform_user_id', 'TEXT', 1, null, 0],
  ['name', 'TEXT', 1, null, 0],
  ['avatar_url', 'TEXT', 0, null, 0],
  ['category_id', 'INTEGER', 0, null, 0],
  ['fail_streak', 'INTEGER', 1, '0', 0],
  ['status', 'TEXT', 1, "'ok'", 0],
  ['created_at', 'TEXT', 1, null, 0],
]
const VIDEOS: Col[] = [
  ['id', 'INTEGER', 0, null, 1],
  ['blogger_id', 'INTEGER', 1, null, 0],
  ['platform_video_id', 'TEXT', 1, null, 0],
  ['title', 'TEXT', 1, null, 0],
  ['url', 'TEXT', 1, null, 0],
  ['thumbnail_url', 'TEXT', 0, null, 0],
  ['duration_seconds', 'INTEGER', 0, null, 0],
  ['published_at', 'INTEGER', 1, null, 0],
  ['created_at', 'TEXT', 1, null, 0],
]
const MODEL_ARCHIVE: Col[] = [
  ['id', 'INTEGER', 0, null, 1],
  ['provider', 'TEXT', 1, null, 0],
  ['official_id', 'TEXT', 1, null, 0],
  ['name', 'TEXT', 1, null, 0],
  ['kind', 'TEXT', 1, null, 0],
  ['stage', 'TEXT', 1, null, 0],
  ['availability', 'TEXT', 1, null, 0],
  ['summary', 'TEXT', 0, null, 0],
  ['sources', 'TEXT', 1, null, 0],
  ['pricing', 'TEXT', 0, null, 0],
  ['limits', 'TEXT', 0, null, 0],
  ['training_params', 'TEXT', 0, null, 0],
  ['created_at', 'TEXT', 1, null, 0],
  ['updated_at', 'TEXT', 1, null, 0],
]
const MODEL_EVENTS: Col[] = [
  ['id', 'INTEGER', 0, null, 1],
  ['model_id', 'INTEGER', 1, null, 0],
  ['kind', 'TEXT', 1, null, 0],
  ['occurred_on', 'TEXT', 1, null, 0],
  ['title', 'TEXT', 1, null, 0],
  ['source_url', 'TEXT', 1, null, 0],
  ['created_at', 'TEXT', 1, null, 0],
]
const MODEL_FETCH_STATUS: Col[] = [
  ['provider', 'TEXT', 1, null, 1],
  ['stale', 'INTEGER', 1, '0', 0],
  ['last_success_at', 'TEXT', 0, null, 0],
  ['last_attempt_at', 'TEXT', 0, null, 0],
]

// openDb(':memory:') 已含 migrate;每个 describe 用新库,互不串数据
function fresh() {
  return openDb(':memory:').sqlite
}

function cols(sqlite: DatabaseType, table: string): Col[] {
  const rows = sqlite.pragma(`table_info(${table})`) as Record<string, unknown>[]
  return rows.map((c) => [c.name, c.type, c.notnull, c.dflt_value, c.pk] as Col)
}

function tableCount(sqlite: DatabaseType): number {
  return (sqlite.prepare("SELECT count(*) c FROM sqlite_master WHERE type='table'").get() as { c: number }).c
}

describe('schema:16 张表结构(research/03 骨架 + sessions + 视频更新三表 + 模型追踪三表 + 评测两表)', () => {
  const sqlite = fresh()

  it.each([
    ['users', USERS],
    ['pages', PAGES],
    ['icons', ICONS],
    ['layout_settings', LAYOUT_SETTINGS],
    ['config_version', CONFIG_VERSION],
    ['changelog_translations', CHANGELOG_TRANSLATIONS],
    ['changelog_snapshots', CHANGELOG_SNAPSHOTS],
    ['sessions', SESSIONS],
    ['video_categories', VIDEO_CATEGORIES],
    ['video_bloggers', VIDEO_BLOGGERS],
    ['videos', VIDEOS],
    ['model_archive', MODEL_ARCHIVE],
    ['model_events', MODEL_EVENTS],
    ['model_fetch_status', MODEL_FETCH_STATUS],
  ] as const)('%s', (table, expected) => {
    expect(cols(sqlite, table)).toEqual(expected)
  })

  it('二级索引 4 个齐备', () => {
    const names = (sqlite.pragma('index_list(icons)') as { name: string }[])
      .map((i) => i.name)
      .sort()
    expect(names).toEqual(['idx_icon_page', 'idx_icon_parent', 'idx_icon_user'])
    expect((sqlite.pragma('index_list(pages)') as { name: string }[]).map((i) => i.name)).toEqual(['idx_page_user'])
  })

  it('全库恰 16 张表', () => {
    expect(tableCount(sqlite)).toBe(16)
  })
})

describe('schema:外键实际生效', () => {
  // grouped:icons 100 为组、101 为组内成员(parent_id 引用)
  function seed(sqlite: DatabaseType) {
    sqlite.exec(`
      INSERT INTO users (id, username, password, created_at) VALUES (1, 'u', 'p', '2026-01-01 00:00:00');
      INSERT INTO pages (id, user_id, name, sort_order, created_at) VALUES (10, 1, 'p1', 0, '2026-01-01 00:00:00');
      INSERT INTO icons (id, user_id, page_id, parent_id, type, sort_order, created_at) VALUES
        (100, 1, 10, NULL, 'LINK', 0, '2026-01-01 00:00:00'),
        (101, 1, 10, 100, 'LINK', 1, '2026-01-01 00:00:00');
    `)
  }

  it('ON DELETE CASCADE:删 user 连带 pages/icons/sessions', () => {
    const sqlite = fresh()
    seed(sqlite)
    // 先拆掉组内引用,级联删除才不被 parent 的 RESTRICT 拦(见下一测试的边界钉住)
    sqlite.exec('UPDATE icons SET parent_id = NULL WHERE id = 101')
    sqlite.exec("INSERT INTO sessions (session_id, user_id, expires_at) VALUES ('s1', 1, '2026-02-01 00:00:00')")
    sqlite.exec('DELETE FROM users WHERE id = 1')
    for (const t of ['pages', 'icons', 'sessions']) {
      expect((sqlite.prepare(`SELECT count(*) c FROM ${t}`).get() as { c: number }).c).toBe(0)
    }
  })

  it('已知边界:icons 存在组内引用时删 user 被拒(research #7)', () => {
    // SQLite 级联删 icons 时组/成员行删除顺序未定义,组行先删则成员的 RESTRICT 拦截。
    // 应用无删用户端点(单管理员),业务写路径也守「先删成员再删组」纪律——零影响。
    const sqlite = fresh()
    seed(sqlite)
    expect(() => sqlite.exec('DELETE FROM users WHERE id = 1')).toThrow()
  })

  it('ON DELETE RESTRICT:删被 parent_id 引用的组被数据库拒绝', () => {
    const sqlite = fresh()
    seed(sqlite)
    expect(() => sqlite.exec('DELETE FROM icons WHERE id = 100')).toThrow()
    expect((sqlite.prepare('SELECT count(*) c FROM icons').get() as { c: number }).c).toBe(2)
  })

  it('TEXT 主键 NOT NULL:session_id 插 NULL 被拒(research 怪癖 #10)', () => {
    const sqlite = fresh()
    seed(sqlite)
    expect(() =>
      sqlite.exec("INSERT INTO sessions (session_id, user_id, expires_at) VALUES (NULL, 1, '2026-02-01 00:00:00')"),
    ).toThrow()
  })

  it('changelog_snapshots 多源共存:source 主键,两源各行(ADR-0020)', () => {
    const sqlite = fresh()
    sqlite.exec(
      "INSERT INTO changelog_snapshots (source, raw_markdown, fetched_at) VALUES ('claude-code', 'x', '2026-01-01 00:00:00'), ('matt-skills', 'y', '2026-01-01 00:00:01')",
    )
    expect(() =>
      sqlite.exec("INSERT INTO changelog_snapshots (source, raw_markdown, fetched_at) VALUES ('claude-code', 'z', '2026-01-02 00:00:00')"),
    ).toThrow()
  })
})

describe('schema:建表幂等', () => {
  it('migrate 重复执行不报错、表数不变', () => {
    const sqlite = fresh()
    expect(() => {
      migrate(sqlite)
      migrate(sqlite)
    }).not.toThrow()
    expect(tableCount(sqlite)).toBe(16)
  })

  it('增量加列:issues/01 时期的旧库(无 pricing/limits/training_params)migrate 后补齐且数据保留', () => {
    // 裸连接复刻 issues/01 形状的 model_archive(11 列),再跑 migrate(fresh() 已自带建表,不能用)
    const sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')
    sqlite.exec(`
      CREATE TABLE model_archive (
          id INTEGER PRIMARY KEY,
          provider TEXT NOT NULL,
          official_id TEXT NOT NULL,
          name TEXT NOT NULL,
          kind TEXT NOT NULL,
          stage TEXT NOT NULL,
          availability TEXT NOT NULL,
          summary TEXT,
          sources TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (provider, official_id)
      );
      INSERT INTO model_archive (provider, official_id, name, kind, stage, availability, sources, created_at, updated_at)
        VALUES ('zhipu', 'glm-5.3', 'GLM-5.3', 'text', 'ga', '["api"]', '[]', '2026-08-19T00:00:00Z', '2026-08-19T00:00:00Z');
    `)
    migrate(sqlite)
    // ALTER 追加列在表尾(顺序与新建库 DDL 不同),按列名集合比对
    expect(cols(sqlite, 'model_archive').map((c) => c[0]).sort()).toEqual(MODEL_ARCHIVE.map((c) => c[0]).sort())
    const row = sqlite.prepare('SELECT pricing, limits, training_params FROM model_archive').get() as Record<string, unknown>
    expect(row).toEqual({ pricing: null, limits: null, training_params: null })
  })
})
