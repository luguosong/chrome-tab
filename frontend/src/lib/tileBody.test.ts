import { describe, expect, it } from 'vitest'
import { NEW_WINDOW_MS, TILE_ROW_CAP, isFreshRow } from './tileBody'

/** 「块内主体」纯规则契约(见 CONTEXT.md「块内主体」)。 */

describe('窗口常量口径', () => {
  it('30 行渲染窗与 24h 红点窗', () => {
    expect(TILE_ROW_CAP).toBe(30)
    expect(NEW_WINDOW_MS).toBe(24 * 60 * 60 * 1000)
  })
})

// 契约面:不锁内部判别机制(量级阈值是实施细节),只钉「三形态都认、非法回落 false」。
describe('isFreshRow', () => {
  const now = Date.now()

  it('ISO 串:24h 内 true,窗外 false', () => {
    expect(isFreshRow(new Date(now - 60_000).toISOString())).toBe(true)
    expect(isFreshRow(new Date(now - (NEW_WINDOW_MS + 60_000)).toISOString())).toBe(false)
  })

  it('秒级数值:24h 内 true,窗外 false', () => {
    expect(isFreshRow(Math.floor((now - 60_000) / 1000))).toBe(true)
    expect(isFreshRow(Math.floor((now - (NEW_WINDOW_MS + 60_000)) / 1000))).toBe(false)
  })

  it('毫秒级数值:24h 内 true,窗外 false', () => {
    expect(isFreshRow(now - 60_000)).toBe(true)
    expect(isFreshRow(now - (NEW_WINDOW_MS + 60_000))).toBe(false)
  })

  it('非法/缺失回落 false(宁不标红)', () => {
    expect(isFreshRow(null)).toBe(false)
    expect(isFreshRow(undefined)).toBe(false)
    expect(isFreshRow('')).toBe(false)
    expect(isFreshRow('not-a-date')).toBe(false)
    expect(isFreshRow(Number.NaN)).toBe(false)
  })
})
