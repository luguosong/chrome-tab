import { describe, expect, it } from 'vitest'
import { canAdd, get, iconCells, listTypes } from './iconTypeRegistry'

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
    expect(get('trending')?.size).toEqual({ w: 3, h: 2 })
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

  it('声明跨格 size(ADR-0021):aihot/changelog/todo 3×2,weather 3×1(首个非 3×2),其余不声明', () => {
    expect(get('aihot')?.size).toEqual({ w: 3, h: 2 })
    expect(get('changelog')?.size).toEqual({ w: 3, h: 2 })
    expect(get('todo')?.size).toEqual({ w: 3, h: 2 })
    expect(get('weather')?.size).toEqual({ w: 3, h: 1 })
    for (const t of ['nav', 'stock', 'group'] as const) {
      expect(get(t)?.size).toBeUndefined()
    }
  })

  it('iconCells:weather 3×1 占 3 格', () => {
    expect(iconCells('weather')).toBe(3)
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
    expect(get('model')?.size).toEqual({ w: 3, h: 2 })
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
    expect(get('news')?.size).toEqual({ w: 3, h: 2 })
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
    expect(get('countdown')?.size).toBeUndefined()
    expect(iconCells('countdown')).toBe(1)
    expect(get('countdown')?.editor).toEqual([])
  })

  it('单例:不存在时允许,已存在时拒绝(新增抽屉置灰的判据)', () => {
    expect(canAdd('countdown', ['nav', 'aihot'])).toBe(true)
    expect(canAdd('countdown', ['nav', 'countdown'])).toBe(false)
  })
})
