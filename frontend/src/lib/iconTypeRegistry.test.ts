import { describe, expect, it } from 'vitest'
import { DEFAULT_CHANGELOG_SOURCE } from 'chrome-tab-shared'
import {
  canAdd,
  decodeIcon,
  encodeIcon,
  get,
  iconCells,
  iconDisplayName,
  listTypes,
  resolveIcon,
} from './iconTypeRegistry'

// 静态类型表直接断言元数据 + 纯查询函数。
// 对齐 spec §接缝2:canAdd(单例判断)纯函数输入输出断言。图标无尺寸档位(ADR-0016)。

describe('内置类型登记', () => {
  it('get() 按 id 取定义', () => {
    expect(get('nav')?.label).toBe('网站链接')
    expect(get('stock')?.label).toBe('自选股')
    expect(get('changelog')?.label).toBe('更新日志')
    expect(get('nonexistent' as never)).toBeUndefined()
  })

  it('trending 登记为中文词条「GitHub 趋势」的单例 3×2(CONTEXT.md 词条;_Avoid_: trending 上游端点名)', () => {
    expect(get('trending')?.label).toBe('GitHub 趋势')
    expect(get('trending')?.singleton).toBe(true)
    expect(get('trending')?.span).toEqual({ w: 3, h: 2 })
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

  it('未知类型拒绝(运行期兜底;类型层面 Record 已全覆盖)', () => {
    expect(canAdd('unknown' as never, [])).toBe(false)
  })
})

describe('更新日志类型 changelog(多源,ADR-0020)', () => {
  it('登记为扩展、非单例,editor 声明 source 字段', () => {
    expect(get('changelog')?.kind).toBe('extension')
    expect(get('changelog')?.singleton).toBe(false)
    expect(get('changelog')?.editor.map((f) => f.name)).toEqual(['source'])
  })
})

describe('天气类型 weather(ADR-0009)', () => {
  it('登记为扩展、非单例', () => {
    expect(get('weather')?.label).toBe('天气')
    expect(get('weather')?.kind).toBe('extension')
    expect(get('weather')?.singleton).toBe(false)
  })

  it('非单例:已有也允许新增(canAdd)', () => {
    expect(canAdd('weather', [])).toBe(true)
    expect(canAdd('weather', ['weather'])).toBe(true)
  })

  it('editor 声明 location 字段(城市选择器)', () => {
    const editor = get('weather')?.editor ?? []
    expect(editor.some((f) => f.name === 'location')).toBe(true)
  })
})

describe('分组类型 group(ADR-0011 / issue 07)', () => {
  it('登记:kind=group(不入新增抽屉 base/extension 分区)、无 editor', () => {
    const g = get('group')
    expect(g?.kind).toBe('group')
    expect(g?.editor).toEqual([])
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

describe('AI 热点类型 aihot(单例,CONTEXT.md「AI 热点」)', () => {
  it('登记为扩展、单例', () => {
    expect(get('aihot')?.label).toBe('AI 热点')
    expect(get('aihot')?.kind).toBe('extension')
    expect(get('aihot')?.singleton).toBe(true)
  })

  it('声明跨格 size(ADR-0021):aihot/changelog/todo 3×2,其余不声明(weather 曾 3×1,2026-09-01 收回 1×1)', () => {
    expect(get('aihot')?.span).toEqual({ w: 3, h: 2 })
    expect(get('changelog')?.span).toEqual({ w: 3, h: 2 })
    expect(get('todo')?.span).toEqual({ w: 3, h: 2 })
    for (const t of ['nav', 'stock', 'weather', 'group'] as const) {
      expect(get(t)?.span).toBeUndefined()
    }
  })

  it('iconCells:未声明 size 的类型占 1 格(weather 收回 1×1 后)', () => {
    expect(iconCells('weather')).toBe(1)
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

describe('模型追踪类型 model(单例,issues/01;CONTEXT.md「模型追踪」)', () => {
  it('登记为扩展、单例', () => {
    expect(get('model')?.label).toBe('模型追踪')
    expect(get('model')?.kind).toBe('extension')
    expect(get('model')?.singleton).toBe(true)
  })

  it('固定占 3×2 跨格(ADR-0021);无实例参数(单例,data 无字段)', () => {
    expect(get('model')?.span).toEqual({ w: 3, h: 2 })
    expect(iconCells('model')).toBe(6)
    expect(get('model')?.editor).toEqual([])
  })

  it('单例:不存在时允许,已存在时拒绝(新增抽屉置灰的判据)', () => {
    expect(canAdd('model', ['nav', 'aihot'])).toBe(true)
    expect(canAdd('model', ['nav', 'model'])).toBe(false)
  })
})

describe('新闻类型 news(单例;CONTEXT.md「新闻」,ADR-0027)', () => {
  it('登记为扩展、单例', () => {
    expect(get('news')?.label).toBe('新闻')
    expect(get('news')?.kind).toBe('extension')
    expect(get('news')?.singleton).toBe(true)
  })

  it('固定占 3×2 跨格(ADR-0021);无实例参数(勾选是账号级后端数据,不进 data)', () => {
    expect(get('news')?.span).toEqual({ w: 3, h: 2 })
    expect(iconCells('news')).toBe(6)
    expect(get('news')?.editor).toEqual([])
  })

  it('单例:不存在时允许,已存在时拒绝(新增抽屉置灰的判据)', () => {
    expect(canAdd('news', ['nav', 'aihot'])).toBe(true)
    expect(canAdd('news', ['nav', 'news'])).toBe(false)
  })
})

describe('倒计时类型 countdown(单例;CONTEXT.md「倒计时」)', () => {
  it('登记为扩展、单例', () => {
    expect(get('countdown')?.label).toBe('倒计时')
    expect(get('countdown')?.kind).toBe('extension')
    expect(get('countdown')?.singleton).toBe(true)
  })

  it('1×1 不声明 size;无实例参数(重要日子寄放布局设置,ADR-0026,不进 data)', () => {
    expect(get('countdown')?.span).toBeUndefined()
    expect(iconCells('countdown')).toBe(1)
    expect(get('countdown')?.editor).toEqual([])
  })

  it('单例:不存在时允许,已存在时拒绝(新增抽屉置灰的判据)', () => {
    expect(canAdd('countdown', ['nav', 'aihot'])).toBe(true)
    expect(canAdd('countdown', ['nav', 'countdown'])).toBe(false)
  })
})

// ── 图标载荷 codec(ADR-0059)──────────────────────────────────────────────
// decode 统一 strict:结构键违规 → null;描述性字符串字段缺失/非串 → '' 宽松投影
// (readWeatherLocation 先例);可选字段缺失是合法载荷(值为 undefined)。

describe('codec decode — 严格/宽松分界', () => {
  it('nav:合法形状 → payload;描述字段非串 → 空串;data null → null', () => {
    expect(decodeIcon('nav', { name: 'GitHub', url: 'https://github.com' })).toEqual({
      name: 'GitHub',
      url: 'https://github.com',
    })
    expect(decodeIcon('nav', { name: 123, url: 'u', icon: 'x.png' })).toEqual({
      name: '',
      url: 'u',
      icon: 'x.png',
    })
    expect(decodeIcon('nav', null)).toBeNull()
  })

  it('nav icon 可选:非串省略,空串保留(与 encode 往返自洽)', () => {
    expect(decodeIcon('nav', { name: 'n', url: 'u', icon: 123 })).toEqual({ name: 'n', url: 'u' })
    expect(decodeIcon('nav', { name: 'n', url: 'u', icon: '' })).toEqual({ name: 'n', url: 'u', icon: '' })
  })

  it('stock:同 flat 形态(symbol/name 宽松投影)', () => {
    expect(decodeIcon('stock', { symbol: 'sh600519', name: '贵州茅台' })).toEqual({
      symbol: 'sh600519',
      name: '贵州茅台',
    })
    expect(decodeIcon('stock', {})).toEqual({ symbol: '', name: '' })
    expect(decodeIcon('stock', null)).toBeNull()
  })

  it('changelog:source 是结构键——非法 id / 缺失 / null → null(兜底走 resolveIcon)', () => {
    expect(decodeIcon('changelog', { source: 'idea' })).toEqual({ source: 'idea' })
    expect(decodeIcon('changelog', { source: 'bogus' })).toBeNull()
    expect(decodeIcon('changelog', {})).toBeNull()
    expect(decodeIcon('changelog', null)).toBeNull()
  })

  it('weather:包壳 readWeatherLocation——lat/lon 非数 → null,描述字段缺失 → 宽松', () => {
    expect(
      decodeIcon('weather', { location: { name: '北京', adm1: '', adm2: '', lat: 39.9, lon: 116.4 } }),
    ).toEqual({ location: { name: '北京', adm1: '', adm2: '', lat: 39.9, lon: 116.4 } })
    expect(decodeIcon('weather', { location: { name: 'x', lat: 'a', lon: 1 } })).toBeNull()
    expect(decodeIcon('weather', { location: { lat: 1, lon: 2 } })).toEqual({
      location: { name: '', adm1: '', adm2: '', lat: 1, lon: 2 },
    })
    expect(decodeIcon('weather', null)).toBeNull()
  })

  it('aihot:name 可选——{} 是合法载荷;data null → null(统一契约)', () => {
    expect(decodeIcon('aihot', { name: 'AI 日报' })).toEqual({ name: 'AI 日报' })
    expect(decodeIcon('aihot', {})).toEqual({})
    expect(decodeIcon('aihot', null)).toBeNull()
  })

  it('group:name 缺失 → 空串(渲染点回落「新建分组」不变)', () => {
    expect(decodeIcon('group', { name: '开发' })).toEqual({ name: '开发' })
    expect(decodeIcon('group', {})).toEqual({ name: '' })
    expect(decodeIcon('group', null)).toBeNull()
  })

  it('空载荷单例(×7):decode/encode 恒 null——条目显式而非缺席', () => {
    for (const t of ['todo', 'video', 'model', 'news', 'trending', 'servers', 'countdown'] as const) {
      expect(decodeIcon(t, null)).toBeNull()
      expect(decodeIcon(t, { whatever: 1 })).toBeNull()
      expect(encodeIcon(t, null)).toBeNull()
    }
  })
})

describe('codec resolveIcon — changelog 行声明兜底(ADR-0020 读侧不改道)', () => {
  it('null / 非法 id / 缺失 → 默认源;合法 id 原样', () => {
    expect(resolveIcon('changelog', null).source).toBe(DEFAULT_CHANGELOG_SOURCE)
    expect(resolveIcon('changelog', { source: 'bogus' }).source).toBe(DEFAULT_CHANGELOG_SOURCE)
    expect(resolveIcon('changelog', {}).source).toBe(DEFAULT_CHANGELOG_SOURCE)
    expect(resolveIcon('changelog', { source: 'codex' }).source).toBe('codex')
  })

  it('无兜底类型:resolveIcon 与 decodeIcon 同值', () => {
    expect(resolveIcon('nav', null)).toBeNull()
    expect(resolveIcon('nav', { name: 'n', url: 'u' })).toEqual({ name: 'n', url: 'u' })
  })
})

describe('codec encode — payload ↔ data 形状往返', () => {
  it('encode(decode(canonical data)) ≡ canonical data(五个有载荷类型)', () => {
    const cases: Array<['nav' | 'stock' | 'changelog' | 'weather' | 'group', Record<string, unknown>]> = [
      ['nav', { name: 'GitHub', url: 'https://github.com', icon: 'https://x/f.png' }],
      ['nav', { name: '', url: 'https://a.b' }],
      ['stock', { symbol: 'sh600519', name: '贵州茅台' }],
      ['changelog', { source: 'idea' }],
      ['weather', { location: { name: '北京', adm1: '北京', adm2: '东城', lat: 39.9, lon: 116.4 } }],
      ['group', { name: '开发' }],
    ]
    for (const [type, data] of cases) {
      const payload = decodeIcon(type, data)
      expect(payload).not.toBeNull()
      expect(encodeIcon(type, payload!)).toEqual(data)
    }
  })

  it('aihot:name 未设时 encode 省略键', () => {
    expect(encodeIcon('aihot', {})).toEqual({})
    expect(encodeIcon('aihot', { name: 'AI 日报' })).toEqual({ name: 'AI 日报' })
  })

  it('encodeIcon 服务编程写路径:分组改名', () => {
    expect(encodeIcon('group', { name: '工具' })).toEqual({ name: '工具' })
  })
})

describe('iconDisplayName — 通用取名(删除确认等)', () => {
  it('声明类型取 payload.name;null 载荷与未声明类型 → 空串', () => {
    expect(iconDisplayName('nav', { name: 'GitHub', url: 'u' })).toBe('GitHub')
    expect(iconDisplayName('stock', { symbol: 's', name: '茅台' })).toBe('茅台')
    expect(iconDisplayName('aihot', { name: 'AI 日报' })).toBe('AI 日报')
    expect(iconDisplayName('group', { name: '开发' })).toBe('开发')
    expect(iconDisplayName('nav', null)).toBe('')
    expect(iconDisplayName('weather', { location: { name: '北京', adm1: '', adm2: '', lat: 1, lon: 2 } })).toBe('')
    expect(iconDisplayName('todo', null)).toBe('')
  })
})
