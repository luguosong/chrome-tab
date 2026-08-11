import { describe, expect, it } from 'vitest'
import {
  canAdd,
  get,
  register,
  sizesFor,
  type IconTypeDefinition,
} from './iconTypeRegistry'
import type { Quote } from './quoteParser'
import type { IconTypeId } from './types'

// 内置三类型由模块加载时登记;此处断言其元数据 + 纯查询函数。
// 对齐 spec §接缝2:canAdd(单例判断)、sizesFor 纯函数输入输出断言。

describe('内置类型登记', () => {
  it('get() 按 id 取定义', () => {
    expect(get('nav')?.label).toBe('网站链接')
    expect(get('stock')?.label).toBe('自选股')
    expect(get('changelog')?.label).toBe('更新日志')
    expect(get('nonexistent' as never)).toBeUndefined()
  })
})

describe('canAdd — 单例判断', () => {
  it('非单例类型恒允许(nav/stock)', () => {
    expect(canAdd('nav', [])).toBe(true)
    expect(canAdd('nav', ['nav', 'nav'])).toBe(true) // 已有也允许
    expect(canAdd('stock', ['stock'])).toBe(true)
  })

  it('单例类型:已存在则拒绝(changelog)', () => {
    expect(canAdd('changelog', [])).toBe(true)
    expect(canAdd('changelog', ['changelog'])).toBe(false)
    // 即使列表里有其它类型,只要 changelog 不在就允许
    expect(canAdd('changelog', ['nav', 'stock'])).toBe(true)
    // 一旦 changelog 在,拒绝
    expect(canAdd('changelog', ['nav', 'changelog'])).toBe(false)
  })

  it('未登记类型拒绝', () => {
    expect(canAdd('unknown' as never, [])).toBe(false)
  })
})

describe('sizesFor — 尺寸档查询', () => {
  it('nav 支持 small/medium/large', () => {
    expect(sizesFor('nav')).toEqual(['small', 'medium', 'large'])
  })

  it('stock 仅 medium/large', () => {
    expect(sizesFor('stock')).toEqual(['medium', 'large'])
  })

  it('changelog 仅 large(单尺寸)', () => {
    expect(sizesFor('changelog')).toEqual(['large'])
  })

  it('未登记类型返回空数组', () => {
    expect(sizesFor('unknown' as never)).toEqual([])
  })
})

describe('summarize — 纯数据提取(无需 DOM)', () => {
  it('stock 有行情:返回价格+涨跌摘要', () => {
    const q: Quote = { price: 308.26, prev: 313.06, change: -4.8, pct: -1.53 }
    const s = get('stock')!.summarize({ symbol: 'usAAPL', name: '苹果' }, { quotes: { usAAPL: q } })
    expect(s).not.toBeNull()
    expect(s!.text).toContain('308.26')
    expect(s!.text).toContain('▼')
    expect(s!.tone).toBe('down')
  })

  it('stock 涨:tone=up ▲', () => {
    const q: Quote = { price: 10, prev: 9, change: 1, pct: 11.11 }
    const s = get('stock')!.summarize({ symbol: 'sh600000' }, { quotes: { sh600000: q } })
    expect(s!.tone).toBe('up')
    expect(s!.text).toContain('▲')
  })

  it('stock 无行情/刷新失败:返回 null(组件降级 "--")', () => {
    expect(get('stock')!.summarize({ symbol: 'usAAPL' }, { quotes: {} })).toBeNull()
    expect(
      get('stock')!.summarize({ symbol: 'usAAPL' }, { quotes: { usAAPL: null } }),
    ).toBeNull()
  })

  it('changelog 有最新版本:返回 title + 首条', () => {
    const v = {
      title: '1.2.3',
      top: ['big feature'],
      sections: [{ name: 'Bug fixes', items: ['fixed X'] }],
    }
    const s = get('changelog')!.summarize(null, { changelog: v })
    expect(s!.title).toBe('1.2.3')
    expect(s!.text).toBe('big feature')
  })

  it('changelog top 空时取 section 首条', () => {
    const v = { title: '1.2.3', top: [], sections: [{ name: 'Bugs', items: ['fix'] }] }
    const s = get('changelog')!.summarize(null, { changelog: v })
    expect(s!.text).toBe('fix')
  })

  it('changelog 无数据:返回 null', () => {
    expect(get('changelog')!.summarize(null, { changelog: null })).toBeNull()
  })

  it('nav 无实时摘要:恒返回 null', () => {
    expect(get('nav')!.summarize({ name: 'x', url: 'https://a.com' }, {})).toBeNull()
  })
})

describe('register — 扩展点(spec 契约:register(typeId, definition))', () => {
  it('register 一个新类型后 get 可见', () => {
    const customId = 'custom-test' as IconTypeId
    const custom: IconTypeDefinition = {
      id: customId,
      label: '测试类型',
      kind: 'extension',
      singleton: false,
      sizes: ['small'],
      defaultSize: 'small',
      refresh: { kind: 'none' },
      detail: 'none',
      editor: [],
      summarize: () => null,
    }
    register(customId, custom)
    expect(get(customId)?.label).toBe('测试类型')
    // 清理:覆盖回一个 noop 定义避免污染其它测试(模块级 registry 是单例)
    register(customId, { ...custom, label: '__cleaned__' })
  })
})
