import { describe, expect, it } from 'vitest'
import {
  canAdd,
  get,
  listTypes,
  register,
  type IconTypeDefinition,
  type SummaryInput,
} from './iconTypeRegistry'
import type { Quote } from './quoteParser'
import type { IconTypeId } from './types'

// 内置类型由模块加载时登记;此处断言其元数据 + 纯查询函数。
// 对齐 spec §接缝2:canAdd(单例判断)纯函数输入输出断言。图标无尺寸档位(ADR-0016)。

describe('内置类型登记', () => {
  it('get() 按 id 取定义', () => {
    expect(get('nav')?.label).toBe('网站链接')
    expect(get('stock')?.label).toBe('自选股')
    expect(get('changelog')?.label).toBe('更新日志')
    expect(get('nonexistent' as never)).toBeUndefined()
  })

  it('nav editor:url 先行(自动加载触发器)+ name + 可选 icon 覆盖', () => {
    expect(get('nav')?.editor.map((f) => f.name)).toEqual(['url', 'name', 'icon'])
  })
})

describe('canAdd — 单例判断', () => {
  it('非单例类型恒允许(nav/stock)', () => {
    expect(canAdd('nav', [])).toBe(true)
    expect(canAdd('nav', ['nav', 'nav'])).toBe(true) // 已有也允许
    expect(canAdd('stock', ['stock'])).toBe(true)
  })

  it('changelog 已非单例(ADR-0020):每实例绑一个外源,已存在也允许', () => {
    expect(canAdd('changelog', [])).toBe(true)
    expect(canAdd('changelog', ['changelog'])).toBe(true) // 已有也允许
    expect(canAdd('changelog', ['changelog', 'changelog'])).toBe(true)
  })

  it('未登记类型拒绝', () => {
    expect(canAdd('unknown' as never, [])).toBe(false)
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

describe('更新日志类型 changelog(多源,ADR-0020)', () => {
  it('登记为扩展、非单例、detail=modal(ADR-0022),editor 声明 source 字段', () => {
    expect(get('changelog')?.kind).toBe('extension')
    expect(get('changelog')?.singleton).toBe(false)
    expect(get('changelog')?.detail).toBe('modal')
    expect(get('changelog')?.editor.map((f) => f.name)).toEqual(['source'])
  })
})

describe('天气类型 weather(ADR-0009)', () => {
  it('登记为扩展、非单例、detail=modal', () => {
    expect(get('weather')?.label).toBe('天气')
    expect(get('weather')?.kind).toBe('extension')
    expect(get('weather')?.singleton).toBe(false)
    expect(get('weather')?.detail).toBe('modal')
  })

  it('非单例:已有也允许新增(canAdd)', () => {
    expect(canAdd('weather', [])).toBe(true)
    expect(canAdd('weather', ['weather'])).toBe(true)
  })

  it('editor 声明 location 字段(城市选择器)', () => {
    const editor = get('weather')?.editor ?? []
    expect(editor.some((f) => f.name === 'location')).toBe(true)
  })

  it('summarize 有实况:返回 城市名 + 温度/文字', () => {
    const data = { location: { name: '北京', adm1: '北京市', adm2: '', lat: 39.92, lon: 116.41 } }
    const live = {
      weather: {
        '39.92,116.41': {
          location: '39.92,116.41',
          now: { temp: 25, text: '多云', icon: '104', obsTime: '', feelsLike: 27, humidity: 60, windDir: '', windScale: '', windSpeed: '', pressure: 1010, vis: 10, precip: 0 },
          air: null,
          alerts: [],
        },
      },
    } as unknown as SummaryInput
    const s = get('weather')!.summarize(data, live)
    expect(s!.title).toBe('北京')
    expect(s!.text).toBe('25° 多云')
    expect(s!.tone).toBe('neutral')
  })

  it('summarize 无 bundle/无 now:返回 null(组件降级)', () => {
    const data = { location: { name: '北京', adm1: '', adm2: '', lat: 39.92, lon: 116.41 } }
    expect(get('weather')!.summarize(data, {})).toBeNull()
    expect(get('weather')!.summarize(data, { weather: { '39.92,116.41': null } })).toBeNull()
  })

  it('summarize 无位置(非法 data):返回 null', () => {
    expect(get('weather')!.summarize(null, {})).toBeNull()
    expect(get('weather')!.summarize({}, {})).toBeNull()
  })
})

describe('分组类型 group(ADR-0011 / issue 07)', () => {
  it('登记:kind=group(不入新增抽屉 base/extension 分区)、无 editor、无摘要', () => {
    const g = get('group')
    expect(g?.kind).toBe('group')
    expect(g?.editor).toEqual([])
    expect(g?.summarize(null, {})).toBeNull()
  })

  it('kind=group 不落新增抽屉任一分区(组只由合并手势诞生)', () => {
    const kinds = listTypes().map((t) => t.kind)
    const drawerKinds = kinds.filter((k) => k === 'base' || k === 'extension')
    expect(drawerKinds).toContain('base')
    expect(drawerKinds).toContain('extension')
    // AddDrawer 渲染 base/extension 两分区,group 不在任一分区 → 不出现
    expect(listTypes().some((t) => t.kind === 'group')).toBe(true)
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

describe('AI 热点类型 aihot(单例,CONTEXT.md「AI 热点」)', () => {
  it('登记为扩展、单例、detail=modal', () => {
    expect(get('aihot')?.label).toBe('AI 热点')
    expect(get('aihot')?.kind).toBe('extension')
    expect(get('aihot')?.singleton).toBe(true)
    expect(get('aihot')?.detail).toBe('modal')
  })

  it('声明跨格 size 3×2(ADR-0021/0022):aihot 与 changelog 跨格,其余不声明', () => {
    expect(get('aihot')?.size).toEqual({ w: 3, h: 2 })
    expect(get('changelog')?.size).toEqual({ w: 3, h: 2 })
    for (const t of ['nav', 'stock', 'weather', 'group'] as const) {
      expect(get(t)?.size).toBeUndefined()
    }
  })

  it('单例:不存在时允许,已存在时拒绝(跨页全局判断)', () => {
    expect(canAdd('aihot', ['nav', 'weather'])).toBe(true)
    expect(canAdd('aihot', ['nav', 'aihot'])).toBe(false)
  })

  it('editor 仅 name 一个可选字段(名称行,空回落默认)', () => {
    const editor = get('aihot')?.editor ?? []
    expect(editor.map((f) => f.name)).toEqual(['name'])
  })
})
