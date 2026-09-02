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
    source        TEXT PRIMARY KEY NOT NULL,
    raw_markdown  TEXT NOT NULL,
    released_at   TEXT,
    release_times TEXT NOT NULL DEFAULT '{}',
    fetched_at    TEXT NOT NULL
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
-- 评测结果快照(issues/08,CONTEXT.md「评测结果」):每 (模型,评测方,Benchmark) 一行,
-- 每轮成功取数整表替换为最新快照(分数漂移只更新行,不产生动态);失败保留最后成功
-- 快照并标记 model_evaluation_status 陈旧——与厂家信源失败(model_fetch_status)互不影响。
CREATE TABLE IF NOT EXISTS model_evaluations (
    id             INTEGER PRIMARY KEY,
    model_id       INTEGER NOT NULL,
    evaluator      TEXT NOT NULL,
    benchmark      TEXT NOT NULL,
    score          REAL NOT NULL,
    version        TEXT NOT NULL,
    url            TEXT NOT NULL,
    snapshot_date  TEXT NOT NULL,
    UNIQUE (model_id, evaluator, benchmark),
    FOREIGN KEY (model_id) REFERENCES model_archive(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS model_evaluation_status (
    evaluator       TEXT PRIMARY KEY NOT NULL,
    stale           INTEGER NOT NULL DEFAULT 0,
    last_success_at TEXT,
    last_attempt_at TEXT
);
-- 待核验线索(2026-08-27 千问/智谱漏检事故):轮询解析出但基线未认领的条目——ADR-0025
-- 「跳过待人工核验」的落地形态,跳过不再静默。upsert-only:基线收录后条目不再被写入,
-- last_seen_at 停更,读侧只取 7 天内仍出现的(滚动信源翻页周期内漏检可见);月之暗面
-- 双页各自 upsert 天然共存。行翻走前线索已可见,「漏了什么」不再不可考。
CREATE TABLE IF NOT EXISTS model_pending_clues (
    provider      TEXT NOT NULL,
    occurred_on   TEXT NOT NULL,
    model_key     TEXT NOT NULL, -- 条目最强标识(千问=模型ID串、智谱=文档链接),provider 内唯一
    title         TEXT NOT NULL,
    source_url    TEXT NOT NULL,
    first_seen_at TEXT NOT NULL,
    last_seen_at  TEXT NOT NULL,
    UNIQUE (provider, model_key)
);
-- 新闻(CONTEXT.md「新闻/新闻源」;ADR-0027:源定义移植 newsnow + cron 预取落库)。
-- news_sources = 账号级勾选注册表 + 取数状态(48 轮失败标 failing,同 video_bloggers 口径);
-- news_items = 源级共享条目池(无 user_id,同源全部勾选用户共享;published_at NULL = 热榜
-- 类上游无逐条时间),每源按 id 降序保留 50,入库即快照不回删。
CREATE TABLE IF NOT EXISTS news_sources (
    user_id        INTEGER NOT NULL,
    source         TEXT NOT NULL,
    enabled        INTEGER NOT NULL DEFAULT 1,
    fail_streak    INTEGER NOT NULL DEFAULT 0,
    status         TEXT NOT NULL DEFAULT 'ok',
    last_success_at TEXT,
    created_at     TEXT NOT NULL,
    UNIQUE (user_id, source), -- 自动索引以 user_id 为前导,单列 user 索引冗余(code-review)
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS news_items (
    id           INTEGER PRIMARY KEY,
    source       TEXT NOT NULL,
    item_id      TEXT NOT NULL,
    title        TEXT NOT NULL,
    url          TEXT NOT NULL,
    published_at INTEGER,
    created_at   TEXT NOT NULL,
    UNIQUE (source, item_id)
);
CREATE INDEX IF NOT EXISTS idx_news_items_source ON news_items (source, id DESC);
-- 英文源标题译文(ADR-0029):主键 = 标题原文 SHA-256,跨条目跨源共享;条目池滚动
-- 裁剪而译文永不裁——热帖回炉/跨源同题直接命中,终身只译一次。年增几万行量级无害。
CREATE TABLE IF NOT EXISTS news_translations (
    title_hash    TEXT PRIMARY KEY NOT NULL,
    translated    TEXT NOT NULL,
    created_at    TEXT NOT NULL
);
-- 趋势仓库描述译文(ADR-0030):主键 = 描述原文 SHA-256,哈希即身份——repo 改描述
-- 即新键自然重译,改回旧值免费命中;孤儿行(描述改版后的旧译文)不清理,量级无害
-- (同 news_translations 口径)。榜单数据本身仍内存缓存不落库(ADR-0028):落库的
-- 只是「原文→中文」永久事实,与榜单生命周期无关——热项目连日在榜,终身只译一次。
CREATE TABLE IF NOT EXISTS trending_translations (
    desc_hash    TEXT PRIMARY KEY NOT NULL,
    translated   TEXT NOT NULL,
    created_at   TEXT NOT NULL
);
-- 已了解标记(CONTEXT.md「已了解」):账号级、项目级(owner/name)持久勾标记——用户
-- 认知状态,不随榜单轮换失效;区别于榜单本体(ADR-0028 不落库),这是用户数据。
-- UNIQUE 以 user_id 为前导即查询索引(同 news_sources 口径),单列 user 索引冗余。
CREATE TABLE IF NOT EXISTS trending_known_marks (
    user_id     INTEGER NOT NULL,
    repo        TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    UNIQUE (user_id, repo),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
-- 服务器状态(CONTEXT.md「服务器状态」):cron 10min 采样落库的数值曲线,全局共享
-- (机器是全局资产,同 model_archive 口径,无 user_id)。services/containers 快照
-- 不落库——展示实时即可,无历史诉求;无保留策略(年增 ~10 万行,SQLite 无压力)。
CREATE TABLE IF NOT EXISTS server_samples (
    id          INTEGER PRIMARY KEY,
    machine     TEXT NOT NULL,
    ts          TEXT NOT NULL,
    cpu_pct     REAL NOT NULL,
    load1       REAL NOT NULL,
    mem_total   INTEGER NOT NULL,
    mem_avail   INTEGER NOT NULL,
    disk_total  INTEGER NOT NULL,
    disk_free   INTEGER NOT NULL,
    uptime_s    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_server_samples_machine_ts ON server_samples (machine, ts);
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
  // releaseTimes 落库(81888ea 曾以「迁移重」不动,2026-08-31 二次线上消失推翻):JSON
  // 存量行 '{}' = 重启恢复空表,等首轮刷新补齐——不回填,日期 immutable 无历史可补。
  addMissingColumns(sqlite, 'changelog_snapshots', { release_times: "TEXT NOT NULL DEFAULT '{}'" })
  // iconScale 撤除用户调节(ADR-0033):存量列删除;新库 DDL 无此列,天然 no-op。
  dropLegacyColumns(sqlite, 'layout_settings', ['icon_scale'])
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

/** 增量删列(ADR-0033 首例):addMissingColumns 的镜像——列在才删,幂等。
 *  SQLite ≥3.35 原生 DROP COLUMN(免表重建),better-sqlite3 自带版本满足。 */
function dropLegacyColumns(sqlite: SqliteConnection, table: string, cols: string[]) {
  const have = new Set((sqlite.pragma(`table_info(${table})`) as { name: string }[]).map((c) => c.name))
  for (const col of cols) {
    if (have.has(col)) sqlite.exec(`ALTER TABLE ${table} DROP COLUMN ${col}`)
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
  /** 版本号→ISO 的 JSON;发布时间 immutable,落库只增不减 */
  release_times: string
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

export interface ModelEvaluationsTable {
  id: Generated<number>
  model_id: number
  evaluator: string
  benchmark: string
  score: number
  version: string
  url: string
  /** YYYY-MM-DD(快照日期,北京时间)。 */
  snapshot_date: string
}

export interface ModelEvaluationStatusTable {
  evaluator: string
  stale: number
  last_success_at: string | null
  last_attempt_at: string | null
}

export interface ModelPendingCluesTable {
  provider: string
  occurred_on: string
  model_key: string
  title: string
  source_url: string
  first_seen_at: string
  last_seen_at: string
}

export interface NewsSourcesTable {
  user_id: number
  source: string
  enabled: number
  fail_streak: number
  status: string
  last_success_at: string | null
  created_at: string
}

export interface NewsItemsTable {
  id: Generated<number>
  source: string
  item_id: string
  title: string
  url: string
  published_at: number | null
  created_at: string
}

export interface NewsTranslationsTable {
  title_hash: string
  translated: string
  created_at: string
}

export interface TrendingTranslationsTable {
  desc_hash: string
  translated: string
  created_at: string
}

export interface TrendingKnownMarksTable {
  user_id: number
  repo: string
  created_at: string
}

export interface ServerSamplesTable {
  id: Generated<number>
  machine: string
  ts: string
  cpu_pct: number
  load1: number
  mem_total: number
  mem_avail: number
  disk_total: number
  disk_free: number
  uptime_s: number
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
  model_evaluations: ModelEvaluationsTable
  model_evaluation_status: ModelEvaluationStatusTable
  model_pending_clues: ModelPendingCluesTable
  news_sources: NewsSourcesTable
  news_items: NewsItemsTable
  news_translations: NewsTranslationsTable
  trending_translations: TrendingTranslationsTable
  trending_known_marks: TrendingKnownMarksTable
  server_samples: ServerSamplesTable
}
