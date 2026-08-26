import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import { type EtlSource, reconcile, runEtl } from './etl'

/**
 * 票 09 ETL 核心:行集(= mysql2 dateStrings 输出形态)→ SQLite 全量灌库 + 对账。
 * mysql2 连接本身不在此测(切换日演练覆盖),seam = 纯数据进、库文件出。
 */

// 模拟 mysql2 dateStrings:true 的输出:DATETIME → 'YYYY-MM-DD HH:MM:SS' 原样字符串,
// BOOLEAN → 1/0,DOUBLE → number,NULL → null。bcrypt 哈希/JSON 串均为逐字节原样拷贝对象。
const source: EtlSource = {
  users: [
    { id: 1, username: 'admin', password: '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', created_at: '2025-01-01 00:00:00' },
    { id: 2, username: 'lgs', password: '$2a$12$XohzImXGADvA0CW8dG0zReUK3FnlM4Cp9QpmnBpEnU3Aw8kTSMm', created_at: '2025-06-15 08:30:12' },
  ],
  pages: [
    { id: 1, user_id: 1, name: '快速导航', sort_order: 0, created_at: '2025-01-01 00:00:01' },
    { id: 2, user_id: 1, name: '行情', sort_order: 1, created_at: '2025-01-01 00:00:02' },
  ],
  icons: [
    { id: 1, user_id: 1, page_id: 1, parent_id: null, type: 'NAV', sort_order: 0, data: '{"name":"GitHub","url":"https://github.com"}', created_at: '2025-01-01 00:00:03' },
    { id: 2, user_id: 1, page_id: 1, parent_id: null, type: 'CHANGELOG', sort_order: 1, data: null, created_at: '2025-01-01 00:00:04' },
    { id: 3, user_id: 1, page_id: 2, parent_id: null, type: 'STOCK', sort_order: 0, data: '{"symbol":"sh600519","name":"贵州茅台"}', created_at: '2025-01-01 00:00:05' },
    // 分组(ADR-0011):组行在前、成员 parent_id 引用组
    { id: 4, user_id: 1, page_id: 1, parent_id: null, type: 'NAV', sort_order: 2, data: '{"name":"组","url":""}', created_at: '2025-02-01 00:00:00' },
    { id: 5, user_id: 1, page_id: 1, parent_id: 4, type: 'NAV', sort_order: 0, data: '{"name":"成员","url":"https://x.dev"}', created_at: '2025-02-01 00:00:01' },
  ],
  layout_settings: [
    { user_id: 1, grid_width: 1280, grid_gap: 8, grid_gap_y: 12, icon_scale: 1.5, panel_fog: 36, search_bar_width: 576, search_bar_visible: 1, search_engine: 'bing', clock_visible: 0, clock_font: 48, clock_24h: 1, label_visible: 1, label_size: 12, label_color: '#ddeeff' },
  ],
  config_version: [
    { user_id: 1, updated_at: '2026-08-20 10:00:00' },
    { user_id: 2, updated_at: '2026-08-21 23:59:59' },
  ],
  changelog_translations: [
    { block_hash: 'a'.repeat(64), translated: '## v1.0.0\n首个版本。', created_at: '2026-01-01 00:00:00' },
    { block_hash: 'b'.repeat(64), translated: '## v1.1.0\n修复。', created_at: '2026-02-01 00:00:00' },
  ],
}

let sqlite: Database.Database
beforeEach(() => {
  sqlite = new Database(':memory:')
})

describe('runEtl', () => {
  it('7 张表逐字节原样灌入(bcrypt/json/时间戳/NULL/大文本;changelog_snapshot 不迁,ADR-0020)', () => {
    runEtl(sqlite, source)
    expect(unwrap(sqlite, 'users')).toEqual(source.users)
    expect(unwrap(sqlite, 'pages')).toEqual(source.pages)
    expect(unwrap(sqlite, 'icons')).toEqual(source.icons)
    // important_dates 是 ETL 后加的列(ADR-0026):旧库无、不迁,灌入后 NULL(读侧兜底 []);
    // icon_scale 已删列(ADR-0033):源行多余字段不落库(源 fixture 保留它,证明旧源兼容)
    expect(unwrap(sqlite, 'layout_settings')).toEqual(
      source.layout_settings.map(({ icon_scale, ...r }) => ({ ...r, important_dates: null })),
    )
    expect(unwrap(sqlite, 'config_version')).toEqual(source.config_version)
    expect(unwrap(sqlite, 'changelog_translations')).toEqual(source.changelog_translations)
  })

  it('重跑幂等:第二次结果 = 第二份行集,无第一次残留', () => {
    runEtl(sqlite, source)
    const second: EtlSource = {
      ...source,
      users: [source.users[0]!],
      pages: [{ id: 9, user_id: 1, name: '新页', sort_order: 0, created_at: '2026-08-22 00:00:00' }],
      icons: [source.icons[0]!],
      config_version: [{ user_id: 1, updated_at: '2026-08-22 12:00:00' }],
      changelog_translations: [],
    }
    runEtl(sqlite, second)
    expect(unwrap(sqlite, 'users')).toHaveLength(1)
    expect(unwrap(sqlite, 'pages')).toEqual(second.pages)
    expect(unwrap(sqlite, 'icons')).toEqual(second.icons)
    expect(unwrap(sqlite, 'config_version')).toEqual(second.config_version)
    expect(unwrap(sqlite, 'changelog_translations')).toEqual([])
  })

  it('外键完好:parent_id 引用不悬挂,后续写入受 FK 约束', () => {
    runEtl(sqlite, source)
    expect(sqlite.pragma('foreign_key_check')).toEqual([])
    // FK 已回 ON:悬挂插入应被拒
    expect(() =>
      sqlite.prepare('INSERT INTO icons (id, user_id, page_id, parent_id, type, sort_order, data, created_at) VALUES (99, 1, 1, 404, ?, 0, NULL, ?)').run('NAV', '2026-01-01 00:00:00'),
    ).toThrow()
  })

  it('事务失败也把外键还回 ON(库不留 FK OFF 状态)', () => {
    const bad = { ...source, users: [{ id: 1 }] } // 缺 NOT NULL 列 → 事务抛错
    expect(() => runEtl(sqlite, bad)).toThrow()
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1)
  })

  it('清掉旧库残留的 sessions(不迁但也不留悬挂引用)', () => {
    runEtl(sqlite, source) // 模拟已服务过的库
    sqlite.exec("INSERT INTO sessions (session_id, user_id, expires_at) VALUES ('s1', 1, '2027-01-01 00:00:00')")
    runEtl(sqlite, source)
    expect(sqlite.prepare('SELECT COUNT(*) n FROM sessions').get()).toEqual({ n: 0 })
  })
})

describe('reconcile', () => {
  it('对账零差异 → ok', () => {
    runEtl(sqlite, source)
    const report = reconcile(sqlite, source)
    expect(report.ok).toBe(true)
    expect(report.tables.map((t) => [t.name, t.source, t.sqlite])).toEqual([
      ['users', 2, 2], ['pages', 2, 2], ['icons', 5, 5], ['layout_settings', 1, 1],
      ['config_version', 2, 2], ['changelog_translations', 2, 2],
    ])
  })

  it('捕获字段篡改(bcrypt 哈希被改)', () => {
    runEtl(sqlite, source)
    sqlite.prepare("UPDATE users SET password = 'oops' WHERE id = 1").run()
    const report = reconcile(sqlite, source)
    expect(report.ok).toBe(false)
    expect(report.tables[0]!.diffs.join('\n')).toContain('users#1.password')
  })

  it('捕获行缺失与残留', () => {
    runEtl(sqlite, source)
    sqlite.prepare('DELETE FROM changelog_translations WHERE block_hash = ?').run('a'.repeat(64))
    sqlite.prepare("INSERT INTO changelog_translations (block_hash, translated, created_at) VALUES (?, '多出的行', '2026-01-01 00:00:00')").run('c'.repeat(64))
    const report = reconcile(sqlite, source)
    expect(report.ok).toBe(false)
    const ct = report.tables.find((t) => t.name === 'changelog_translations')!
    expect(ct.source).toBe(2)
    expect(ct.sqlite).toBe(2)
    expect(ct.diffs.join('\n')).toContain('missing')
    expect(ct.diffs.join('\n')).toContain('extra')
  })

  it('捕获 icons.data 非法 JSON', () => {
    runEtl(sqlite, source)
    sqlite.prepare("UPDATE icons SET data = '{oops' WHERE id = 1").run()
    const report = reconcile(sqlite, source)
    expect(report.ok).toBe(false)
    expect(report.invalidJsonIcons).toContain(1)
  })
})

function unwrap(sqlite: Database.Database, table: string) {
  return sqlite.prepare(`SELECT * FROM ${table}`).all()
}
