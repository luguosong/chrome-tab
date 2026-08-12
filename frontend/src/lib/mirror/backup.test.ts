import { describe, expect, it } from 'vitest'
import {
  BACKUP_SCHEMA_VERSION,
  mergeBlobs,
  parseBackupPayload,
  toBackupPayload,
  toWireConfig,
} from './backup'
import type { Config } from '../types'

function cfg(): Config {
  return {
    pages: [{ id: 1, name: 'P1', sortOrder: 0 }],
    icons: [
      { id: 7, pageId: 1, type: 'nav', size: 'small', sortOrder: 0, data: { name: 'a', url: 'https://x.com' } },
    ],
    layoutSettings: { gridWidth: 1024, gridGap: 8, iconScale: 1 },
    updatedAt: '2026-08-12T10:00:00',
  }
}

describe('toWireConfig', () => {
  it('小写枚举转大写,pages 保留 id,icons 去掉 id,layoutSettings 透传', () => {
    const w = toWireConfig(cfg())
    expect(w.pages[0]).toEqual({ id: 1, name: 'P1', sortOrder: 0 })
    expect(w.icons[0]).toEqual({
      pageId: 1,
      type: 'NAV',
      size: 'SMALL',
      sortOrder: 0,
      data: { name: 'a', url: 'https://x.com' },
    })
    expect(w.layoutSettings).toEqual({ gridWidth: 1024, gridGap: 8, iconScale: 1 })
  })
})

describe('toBackupPayload / parseBackupPayload', () => {
  it('往返:导出再解析得到等价 payload,schemaVersion 匹配', () => {
    const p = toBackupPayload(cfg())
    expect(p.schemaVersion).toBe(BACKUP_SCHEMA_VERSION)
    expect(typeof p.exportedAt).toBe('string')
    const parsed = parseBackupPayload(JSON.parse(JSON.stringify(p)))
    expect(parsed.config.pages).toEqual(p.config.pages)
  })
  it('schemaVersion 不符 → 抛', () => {
    expect(() => parseBackupPayload({ schemaVersion: 99, config: { pages: [], icons: [] } })).toThrow(
      /版本不兼容/,
    )
  })
  it('缺少 pages/icons → 抛', () => {
    expect(() => parseBackupPayload({ schemaVersion: BACKUP_SCHEMA_VERSION, config: { pages: [] } })).toThrow(
      /缺少/,
    )
  })
  it('非对象 → 抛', () => {
    expect(() => parseBackupPayload('nope')).toThrow(/格式不正确/)
  })
})

describe('mergeBlobs', () => {
  it('导入页重键到现有最大 id 之后,icon pageId 随之重映射,追加到末尾', () => {
    const imported = {
      pages: [{ id: 1, name: 'IMP', sortOrder: 0 }],
      icons: [{ pageId: 1, type: 'NAV', size: 'LARGE', sortOrder: 0, data: null }],
      layoutSettings: { gridWidth: 999, gridGap: 999, iconScale: 999 },
    }
    const merged = mergeBlobs(cfg(), imported)
    // 现有页 id=1 保留,导入页重键为 2(= max(1)+1)
    expect(merged.pages.map((p) => p.id)).toEqual([1, 2])
    expect(merged.pages[1].name).toBe('IMP')
    // 现有 icon(原 pageId 1)不变;导入 icon 重映射到 pageId 2
    expect(merged.icons[0].pageId).toBe(1)
    expect(merged.icons[1].pageId).toBe(2)
    expect(merged.icons[1].type).toBe('NAV')
    // 导入布局被忽略,沿用 current
    expect(merged.layoutSettings).toEqual({ gridWidth: 1024, gridGap: 8, iconScale: 1 })
  })
})
