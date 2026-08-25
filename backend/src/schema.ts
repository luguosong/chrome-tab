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
    label_color       TEXT    NOT NULL DEFAULT '#ffffff',
    important_dates   TEXT
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
-- 多源快照(ADR-0020):每源一行。前身 changelog_snapshot(id=1 单行)已废弃——
-- SQLite 改不了已存表的 CHECK,旧库中该表原地留存为孤儿缓存,不迁移(快照可重建)。
CREATE TABLE IF NOT EXISTS changelog_snapshots (
    source       TEXT PRIMARY KEY NOT NULL,
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
-- 视频更新(CONTEXT.md「视频更新/博主/分类」;ADR-0023 持久化轮询):博主注册表与
-- 视频是账号级数据(user_id 同 pages 口径),不塞图标 data。published_at 为 unix 秒;
-- 裁剪(每博主保最新 50)由应用层在入库事务内做,无 DB 默认依赖(同全局惯例)。
CREATE TABLE IF NOT EXISTS video_categories (
    id          INTEGER PRIMARY KEY,
    user_id     INTEGER NOT NULL,
    name        TEXT NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_video_category_user ON video_categories (user_id);
CREATE TABLE IF NOT EXISTS video_bloggers (
    id                INTEGER PRIMARY KEY,
    user_id           INTEGER NOT NULL,
    platform          TEXT NOT NULL,
    platform_user_id  TEXT NOT NULL,
    name              TEXT NOT NULL,
    avatar_url        TEXT,
    category_id       INTEGER REFERENCES video_categories(id) ON DELETE SET NULL,
    fail_streak       INTEGER NOT NULL DEFAULT 0,
    status            TEXT NOT NULL DEFAULT 'ok',
    created_at        TEXT NOT NULL,
    UNIQUE (user_id, platform, platform_user_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_video_blogger_user ON video_bloggers (user_id);
CREATE TABLE IF NOT EXISTS videos (
    id                INTEGER PRIMARY KEY,
    blogger_id        INTEGER NOT NULL,
    platform_video_id TEXT NOT NULL,
    title             TEXT NOT NULL,
    url               TEXT NOT NULL,
    thumbnail_url     TEXT,
    duration_seconds  INTEGER,
    published_at      INTEGER NOT NULL,
    created_at        TEXT NOT NULL,
    UNIQUE (blogger_id, platform_video_id),
    FOREIGN KEY (blogger_id) REFERENCES video_bloggers(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_videos_blogger_pub ON videos (blogger_id, published_at DESC);
-- 模型追踪(CONTEXT.md「模型追踪/模型档案」;ADR-0025):三表全为**全局**数据,无 user_id——
-- 档案对所有用户共享(区别于 video_* 的账号级)。模型档案行来自代码内人工核验基线
-- (idempotent upsert,部署即刷新 profile 字段);模型动态来自厂家发布页确定性解析
-- (去重键 = 模型 + 类型 + 日期 + 信源,ON CONFLICT 幂等);occurred_on 为日期文本。
CREATE TABLE IF NOT EXISTS model_archive (
    id           INTEGER PRIMARY KEY,
    provider     TEXT NOT NULL,
    official_id  TEXT NOT NULL,
    name         TEXT NOT NULL,
    kind         TEXT NOT NULL,
    stage        TEXT NOT NULL,
    availability TEXT NOT NULL,
    summary      TEXT,
    sources      TEXT NOT NULL,
    pricing      TEXT,
    limits       TEXT,
    training_params TEXT,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    UNIQUE (provider, official_id)
);
CREATE TABLE IF NOT EXISTS model_events (
    id          INTEGER PRIMARY KEY,
    model_id    INTEGER NOT NULL,
    kind        TEXT NOT NULL,
    occurred_on TEXT NOT NULL,
    title       TEXT NOT NULL,
    source_url  TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    UNIQUE (model_id, kind, occurred_on, source_url),
    FOREIGN KEY (model_id) REFERENCES model_archive(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_model_events_model ON model_events (model_id, occurred_on DESC);
CREATE TABLE IF NOT EXISTS model_fetch_status (
    provider        TEXT PRIMARY KEY NOT NULL,
    stale           INTEGER NOT NULL DEFAULT 0,
    last_success_at TEXT,
    last_attempt_at TEXT
);
`

/** openDb 打开连接后即执行;幂等(IF NOT EXISTS + 增量加列)。 */
export function migrate(sqlite: SqliteConnection) {
  sqlite.exec(SCHEMA_SQL)
  addMissingColumns(sqlite, 'model_archive', {
    pricing: 'TEXT',
    limits: 'TEXT',
    training_params: 'TEXT',
  })
  // 「重要日子」寄放布局设置(ADR-0026):存量行 NULL,读侧兜底 []。
  addMissingColumns(sqlite, 'layout_settings', { important_dates: 'TEXT' })
}

/**
 * 增量加列(issues/02):CREATE IF NOT EXISTS 不改既有表,issues/01 时期的旧库靠
 * ALTER 补列。全 NULL 可加列(无默认值/非空),SQLite 免表重建;空库首启走 DDL 本身,
 * 此处天然 no-op。
 */
function addMissingColumns(sqlite: SqliteConnection, table: string, defs: Record<string, string>) {
  const have = new Set((sqlite.pragma(`table_info(${table})`) as { name: string }[]).map((c) => c.name))
  for (const [col, ddl] of Object.entries(defs)) {
    if (!have.has(col)) sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`)
  }
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
  /** JSON 文本(ImportantDate[]);存量行 NULL(ADR-0026 加列)。 */
  important_dates: string | null
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

export interface ChangelogSnapshotsTable {
  source: string
  raw_markdown: string
  released_at: string | null
  fetched_at: string
}

export interface SessionsTable {
  session_id: string
  user_id: number
  expires_at: string
}

export interface VideoCategoriesTable {
  id: Generated<number>
  user_id: number
  name: string
  sort_order: number
  created_at: string
}

export interface VideoBloggersTable {
  id: Generated<number>
  user_id: number
  platform: string
  platform_user_id: string
  name: string
  avatar_url: string | null
  category_id: number | null
  fail_streak: number
  status: string
  created_at: string
}

export interface VideosTable {
  id: Generated<number>
  blogger_id: number
  platform_video_id: string
  title: string
  url: string
  thumbnail_url: string | null
  duration_seconds: number | null
  published_at: number
  created_at: string
}

export interface ModelArchiveTable {
  id: Generated<number>
  provider: string
  official_id: string
  name: string
  kind: string
  stage: string
  /** JSON 数组文本(应用层序列化,同 icons.data 约定)。 */
  availability: string
  summary: string | null
  /** JSON 数组文本([{title,url}])。 */
  sources: string
  /** JSON 文本(ModelPricing;null = 官方未核验到现价)。 */
  pricing: string | null
  /** JSON 数组文本(ModelLimit[];null = 未披露)。 */
  limits: string | null
  /** 官方披露的训练参数量原文;null = 未披露。 */
  training_params: string | null
  created_at: string
  updated_at: string
}

export interface ModelEventsTable {
  id: Generated<number>
  model_id: number
  kind: string
  occurred_on: string
  title: string
  source_url: string
  created_at: string
}

export interface ModelFetchStatusTable {
  provider: string
  stale: number
  last_success_at: string | null
  last_attempt_at: string | null
}

export interface SchemaDatabase {
  users: UsersTable
  pages: PagesTable
  icons: IconsTable
  layout_settings: LayoutSettingsTable
  config_version: ConfigVersionTable
  changelog_translations: ChangelogTranslationsTable
  changelog_snapshots: ChangelogSnapshotsTable
  sessions: SessionsTable
  video_categories: VideoCategoriesTable
  video_bloggers: VideoBloggersTable
  videos: VideosTable
  model_archive: ModelArchiveTable
  model_events: ModelEventsTable
  model_fetch_status: ModelFetchStatusTable
}
