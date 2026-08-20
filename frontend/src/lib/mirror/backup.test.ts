import { describe, expect, it } from 'vitest'
import {
  BACKUP_SCHEMA_VERSION,
  mergeBlobs,
  parseBackupPayload,
  toBackupPayload,
  toWireConfig,
} from './backup'
import type { Config } from '../types'
import { DEFAULT_LAYOUT_SETTINGS } from '../layoutSettings'

function cfg(): Config {
  return {
    pages: [{ id: 1, name: 'P1', sortOrder: 0 }],
    icons: [
      { id: 7, pageId: 1, parentId: null, type: 'nav', sortOrder: 0, data: { name: 'a', url: 'https://x.com' } },
    ],
    layoutSettings: { ...DEFAULT_LAYOUT_SETTINGS },
    updatedAt: '2026-08-12T10:00:00',
  }
}

describe('toWireConfig', () => {
  it('小写枚举转大写,pages/icons 保留 id 与 parentId,layoutSettings 透传', () => {
    const w = toWireConfig(cfg())
    expect(w.pages[0]).toEqual({ id: 1, name: 'P1', sortOrder: 0 })
    expect(w.icons[0]).toEqual({
      id: 7,
      pageId: 1,
      parentId: null,
      type: 'NAV',
      sortOrder: 0,
      data: { name: 'a', url: 'https://x.com' },
    })
    expect(w.layoutSettings).toEqual({ ...DEFAULT_LAYOUT_SETTINGS })
  })
})

describe('toBackupPayload / parseBackupPayload', () => {
  it('往返:导出再解析得到等价 payload', () => {
    const p = toBackupPayload(cfg())
    expect(p.schemaVersion).toBe(BACKUP_SCHEMA_VERSION)
    expect(p.schemaVersion).toBe(3)
    expect(typeof p.exportedAt).toBe('string')
    const parsed = parseBackupPayload(JSON.parse(JSON.stringify(p)))
    expect(parsed.config.pages).toEqual(p.config.pages)
    expect(parsed.config.icons).toEqual(p.config.icons)
  })
  it('v1 备份(无 id/parentId)双接受:icons 按序补 id、parentId=null', () => {
    const v1 = {
      schemaVersion: 1,
      exportedAt: '2026-01-01T00:00:00Z',
      config: { pages: [{ id: 1, name: 'P', sortOrder: 0 }], icons: [{ pageId: 1, type: 'NAV', size: 'SMALL', sortOrder: 0, data: null }], layoutSettings: null },
    }
    const parsed = parseBackupPayload(JSON.parse(JSON.stringify(v1)))
    expect(parsed.config.icons[0].id).toBe(1)
    expect(parsed.config.icons[0].parentId).toBeNull()
  })
  it('v2 备份(带 ADR-0016 前的 size 字段)接受:size 为多余字段透传、由后端忽略', () => {
    const v2 = {
      schemaVersion: 2,
      exportedAt: '2026-01-01T00:00:00Z',
      config: { pages: [{ id: 1, name: 'P', sortOrder: 0 }], icons: [{ id: 3, pageId: 1, parentId: null, type: 'NAV', size: 'LARGE', sortOrder: 0, data: null }], layoutSettings: null },
    }
    const parsed = parseBackupPayload(JSON.parse(JSON.stringify(v2)))
    expect(parsed.config.icons[0].id).toBe(3)
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
  it('导入页/icon 重键到现有最大 id 之后,pageId/parentId 随之重映射,追加到末尾', () => {
    const current: Config = {
      ...cfg(),
      icons: [
        { id: 7, pageId: 1, parentId: null, type: 'nav', sortOrder: 0, data: null },
        // 组(id 9)+ 一个成员(parentId 9):现有组的 id 不参与导入重映射,原样保留
        { id: 9, pageId: 1, parentId: null, type: 'group', sortOrder: 1, data: { name: '组' } },
        { id: 10, pageId: 1, parentId: 9, type: 'nav', sortOrder: 0, data: null },
      ],
    }
    const imported = {
      pages: [{ id: 1, name: 'IMP', sortOrder: 0 }],
      icons: [
        { id: 5, pageId: 1, parentId: null, type: 'GROUP', size: 'SMALL', sortOrder: 0, data: { name: '导入组' } },
        { id: 6, pageId: 1, parentId: 5, type: 'NAV', size: 'LARGE', sortOrder: 0, data: null },
      ],
      layoutSettings: { gridWidth: 999, gridGap: 999, iconScale: 999 },
    }
    const merged = mergeBlobs(current, imported)
    // 现有页 id=1 保留,导入页重键为 2;导入 icon 重键为 11/12(= max(7,9,10)+1 起)
    expect(merged.pages.map((p) => p.id)).toEqual([1, 2])
    expect(merged.icons.map((i) => [i.id, i.pageId, i.parentId])).toEqual([
      [7, 1, null],
      [9, 1, null],
      [10, 1, 9],
      [11, 2, null],   // 导入组行
      [12, 2, 11],     // 导入成员:parentId 重映射到导入组的新 id
    ])
    // 导入布局被忽略,沿用 current
    expect(merged.layoutSettings).toEqual({ ...DEFAULT_LAYOUT_SETTINGS })
  })
  it('成员引用未导入的组 → 跳过该行(照 pageId 先例)', () => {
    const imported = {
      pages: [{ id: 1, name: 'IMP', sortOrder: 0 }],
      icons: [{ id: 6, pageId: 1, parentId: 999, type: 'NAV', size: 'SMALL', sortOrder: 0, data: null }],
      layoutSettings: null,
    }
    const merged = mergeBlobs(cfg(), imported)
    expect(merged.icons).toHaveLength(1)   // 仅 current 的 1 个
    expect(merged.icons[0].id).toBe(7)
  })
})
