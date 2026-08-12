import { describe, expect, it } from 'vitest'
import { buildIconData } from './iconData'
import type { EditorField } from './iconTypeRegistry'

// buildIconData:新增抽屉与编辑 popover 共用的 data 装配(见 lib/iconData.ts)。

const NAME: EditorField = { name: 'name', label: '名称', placeholder: '名称' }
const URL: EditorField = { name: 'url', label: '网址', placeholder: 'https://…' }
const SYMBOL: EditorField = { name: 'symbol', label: '符号', placeholder: '符号' }

describe('buildIconData', () => {
  it('空 editor 返回 null(changelog 等无配置类型)', () => {
    expect(buildIconData([], {})).toBeNull()
  })

  it('nav: 装配 name + url,url 走 normalizeUrl 补前缀', () => {
    const d = buildIconData([NAME, URL], { name: 'GitHub', url: 'github.com' })
    expect(d).toEqual({ name: 'GitHub', url: 'https://github.com' })
  })

  it('各字段去首尾空白', () => {
    const d = buildIconData([NAME, URL], { name: '  GitHub  ', url: '  https://a.com  ' })
    expect(d).toEqual({ name: 'GitHub', url: 'https://a.com' })
  })

  it('已有 https:// 前缀的 url 不重复补全', () => {
    expect(buildIconData([URL], { url: 'https://a.com' })).toEqual({ url: 'https://a.com' })
  })

  it('缺失字段按空串处理(不抛错)', () => {
    expect(buildIconData([NAME, URL], { name: 'X' })).toEqual({ name: 'X', url: '' })
  })

  it('stock: 装配 symbol + name(无 url 归一化)', () => {
    expect(buildIconData([SYMBOL, NAME], { symbol: 'usAAPL', name: '苹果' })).toEqual({
      symbol: 'usAAPL',
      name: '苹果',
    })
  })
})
