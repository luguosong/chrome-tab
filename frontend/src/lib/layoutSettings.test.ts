import { describe, expect, it } from 'vitest'
import { DEFAULT_LAYOUT_SETTINGS, withDefaults } from './layoutSettings'

describe('withDefaults', () => {
  it('returns full defaults for null/undefined', () => {
    expect(withDefaults(null)).toEqual(DEFAULT_LAYOUT_SETTINGS)
    expect(withDefaults(undefined)).toEqual(DEFAULT_LAYOUT_SETTINGS)
  })

  it('fills only missing fields, keeps provided (0 is a valid gap)', () => {
    expect(withDefaults({ gridWidth: 800 })).toEqual({
      ...DEFAULT_LAYOUT_SETTINGS,
      gridWidth: 800,
    })
    expect(withDefaults({ gridGap: 0 })).toEqual({
      ...DEFAULT_LAYOUT_SETTINGS,
      gridGap: 0,
    })
  })

  it('fills expanded fields (old server payload / old backup) with defaults', () => {
    // 旧后端/旧备份的 blob:缺的字段补默认;已撤除字段(iconScale,ADR-0033)被丢弃。
    // 经变量传入绕开字面量超额属性检查——旧备份就是带着这个多余键来的。
    const legacyBlob = { gridWidth: 1024, gridGap: 8, iconScale: 1.5 }
    expect(withDefaults(legacyBlob)).toEqual(DEFAULT_LAYOUT_SETTINGS)
  })

  it('keeps provided expanded fields (0 雾化、false 显隐都是合法值)', () => {
    expect(
      withDefaults({
        panelFog: 0,
        searchBarVisible: false,
        clockVisible: false,
        clock24h: false,
        labelVisible: false,
        searchEngine: 'baidu',
        labelColor: '#123456',
      }),
    ).toEqual({
      ...DEFAULT_LAYOUT_SETTINGS,
      panelFog: 0,
      searchBarVisible: false,
      clockVisible: false,
      clock24h: false,
      labelVisible: false,
      searchEngine: 'baidu',
      labelColor: '#123456',
    })
  })
})
