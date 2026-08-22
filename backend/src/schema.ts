import type { Database as SqliteConnection } from 'better-sqlite3'
import type { Generated } from 'kysely'

/**
 * 8 张表 DDL = research/03 建表骨架(7 张 MySQL 平移,方言适配已实验验证)
 * + spec 新增 sessions。方言要点:
 * - json 列本就是 TEXT 存 JSON,应用层序列化;
 * - 时间戳全由代码赋值(ISO-8601 UTC 文本),无 DB 默认依赖;
 * - ON UPDATE CURRENT_TIMESTAMP 无对应物,layout_settings.updated_at 直接删除(应用从不读);
 * - TEXT 主键必须显式 NOT NULL(SQLite 历史怪癖:不写可插 NULL);
 * - IF NOT EXISTS:空库首启与重启重复执行幂等。
 */
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY,
    username    TEXT NOT NULL UNIQUE,
    password    TEXT NOT NULL,
    created_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pages (
    id          INTEGER PRIMARY KEY,
    user_id     INTEGER NOT NULL,
    name        TEXT NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_page_user ON pages (user_id);
CREATE TABLE IF NOT EXISTS icons (
    id          INTEGER PRIMARY KEY,
    user_id     INTEGER NOT NULL,
    page_id     INTEGER NOT NULL,
    parent_id   INTEGER REFERENCES icons(id) ON DELETE RESTRICT,
    type        TEXT NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    data        TEXT,
    created_at  TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_icon_user ON icons (user_id);
CREATE INDEX IF NOT EXISTS idx_icon_page ON icons (page_id);
CREATE INDEX IF NOT EXISTS idx_icon_parent ON icons (parent_id);
CREATE TABLE IF NOT EXISTS layout_settings (
    user_id           INTEGER PRIMARY KEY,
    grid_width        INTEGER NOT NULL,
    grid_gap          INTEGER NOT NULL,
    grid_gap_y        INTEGER NOT NULL DEFAULT 8,
    icon_scale        REAL    NOT NULL,
    panel_fog         INTEGER NOT NULL DEFAULT 36,
    search_bar_width  INTEGER NOT NULL DEFAULT 576,
    search_bar_visible INTEGER NOT NULL DEFAULT 1,
    search_engine     TEXT    NOT NULL DEFAULT 'google',
    clock_visible     INTEGER NOT NULL DEFAULT 1,
    clock_font        INTEGER NOT NULL DEFAULT 48,
    clock_24h         INTEGER NOT NULL DEFAULT 1,
    label_visible     INTEGER NOT NULL DEFAULT 1,
    label_size        INTEGER NOT NULL DEFAULT 12,
    label_color       TEXT    NOT NULL DEFAULT '#ffffff'
);
CREATE TABLE IF NOT EXISTS config_version (
    user_id     INTEGER PRIMARY KEY,
    updated_at  TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS changelog_translations (
    block_hash  TEXT PRIMARY KEY NOT NULL,
    translated  TEXT NOT NULL,
    created_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS changelog_snapshot (
    id           INTEGER PRIMARY KEY CHECK (id = 1),
    raw_markdown TEXT NOT NULL,
    released_at  TEXT,
    fetched_at   TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
    session_id  TEXT PRIMARY KEY NOT NULL,
    user_id     INTEGER NOT NULL,
    expires_at  TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
`

/** openDb 打开连接后即执行;幂等(IF NOT EXISTS)。 */
export function migrate(sqlite: SqliteConnection) {
  sqlite.exec(SCHEMA_SQL)
}

// ---- Kysely 表类型(列名/可空性对齐上面的 DDL;票 04+ 的 CRUD 地基)----

export interface UsersTable {
  id: Generated<number>
  username: string
  password: string
  created_at: string
}

export interface PagesTable {
  id: Generated<number>
  user_id: number
  name: string
  sort_order: number
  created_at: string
}

export interface IconsTable {
  id: Generated<number>
  user_id: number
  page_id: number
  parent_id: number | null
  type: string
  sort_order: number
  /** JSON 文本(应用层序列化,沿用 Java JsonMapConverter 约定) */
  data: string | null
  created_at: string
}

export interface LayoutSettingsTable {
  user_id: number
  grid_width: number
  grid_gap: number
  grid_gap_y: number
  icon_scale: number
  panel_fog: number
  search_bar_width: number
  search_bar_visible: number
  search_engine: string
  clock_visible: number
  clock_font: number
  clock_24h: number
  label_visible: number
  label_size: number
  label_color: string
}

export interface ConfigVersionTable {
  user_id: number
  updated_at: string
}

export interface ChangelogTranslationsTable {
  block_hash: string
  translated: string
  created_at: string
}

export interface ChangelogSnapshotTable {
  id: number
  raw_markdown: string
  released_at: string | null
  fetched_at: string
}

export interface SessionsTable {
  session_id: string
  user_id: number
  expires_at: string
}

export interface SchemaDatabase {
  users: UsersTable
  pages: PagesTable
  icons: IconsTable
  layout_settings: LayoutSettingsTable
  config_version: ConfigVersionTable
  changelog_translations: ChangelogTranslationsTable
  changelog_snapshot: ChangelogSnapshotTable
  sessions: SessionsTable
}
