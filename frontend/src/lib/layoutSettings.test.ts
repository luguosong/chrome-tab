import { describe, expect, it } from 'vitest'
import { DEFAULT_LAYOUT_SETTINGS, withDefaults } from './layoutSettings'

describe('withDefaults', () => {
  it('returns full defaults for null/undefined', () => {
    expect(withDefaults(null)).toEqual(DEFAULT_LAYOUT_SETTINGS)
    expect(withDefaults(undefined)).toEqual(DEFAULT_LAYOUT_SETTINGS)
  })

  it('fills only missing fields, keeps provided (0 is a valid gap)', () => {
    expect(withDefaults({ gridWidth: 800 })).toEqual({
      gridWidth: 800,
      gridGap: 8,
      iconScale: 1.0,
    })
    expect(withDefaults({ gridGap: 0 })).toEqual({
      gridWidth: 1024,
      gridGap: 0,
      iconScale: 1.0,
    })
  })
})
