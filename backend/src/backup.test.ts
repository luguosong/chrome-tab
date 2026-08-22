import Database from 'better-sqlite3'
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { dailyBackup } from './backup'

/**
 * 票 09 每日备份:VACUUM INTO 产一致单文件快照(research/03 §4;live 库安全,禁止直接 cp),
 * 当日重跑幂等跳过(目标存在会报错),过期备份裁剪。
 */

const dir = join(tmpdir(), `newtab-backup-test-${process.pid}`)
beforeEach(() => mkdirSync(dir, { recursive: true }))
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function makeDb() {
  const db = new Database(':memory:')
  db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)')
  db.prepare('INSERT INTO t (v) VALUES (?)').run('x'.repeat(1000))
  return db
}

describe('dailyBackup', () => {
  it('产出可独立打开的完整快照,integrity_check 通过', () => {
    dailyBackup(makeDb(), dir)
    const [file] = readdirSync(dir)
    expect(file).toMatch(/^newtab-\d{4}-\d{2}-\d{2}\.db$/)
    const copy = new Database(join(dir, file!))
    expect(copy.pragma('integrity_check', { simple: true })).toBe('ok')
    expect((copy.prepare('SELECT v FROM t').get() as { v: string }).v).toBe('x'.repeat(1000))
  })

  it('同日重跑幂等跳过(不报错、不重复产出)', () => {
    dailyBackup(makeDb(), dir)
    dailyBackup(makeDb(), dir)
    expect(readdirSync(dir)).toHaveLength(1)
  })

  it('只保留最近 14 份,更旧的被删', () => {
    // 预置 15 个历史备份(旧日期),再触发一次 → 剩 14 份且最旧的没了
    for (let i = 1; i <= 15; i++) writeFileSync(join(dir, `newtab-2020-01-${String(i).padStart(2, '0')}.db`), '')
    dailyBackup(makeDb(), dir)
    const files = readdirSync(dir).sort()
    expect(files).toHaveLength(14)
    expect(files).not.toContain('newtab-2020-01-01.db')
  })
})
