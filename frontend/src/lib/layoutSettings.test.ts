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
    // 旧后端/旧备份只带三字段的 blob:新字段全部补默认,升级零视觉变化
    expect(withDefaults({ gridWidth: 1024, gridGap: 8, iconScale: 1.0 })).toEqual(
      DEFAULT_LAYOUT_SETTINGS,
    )
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
