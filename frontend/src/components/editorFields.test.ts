import { describe, expect, it } from 'vitest'
import { CHANGELOG_SOURCES, DEFAULT_CHANGELOG_SOURCE } from 'chrome-tab-shared'
import { missingRequiredText, prefillFields, serializeFields } from './editorFields'
import type { EditorField } from '../lib/iconTypeRegistry'

// editorFields:字段渲染 seam 的纯决策面(编辑预填 / 表单值→data 序列化 / 新增必填门)。
// 渲染控件与两表单的接线是薄 map,按 repo 惯例不测组件(见 components/editorFields.tsx)。

const NAME: EditorField = { name: 'name', label: '名称', placeholder: '名称' }
const URL: EditorField = { name: 'url', label: '网址', placeholder: 'https://…' }
const SYMBOL: EditorField = { name: 'symbol', label: '符号', placeholder: '符号' }
const LOCATION: EditorField = { name: 'location', label: '城市', placeholder: '搜索城市' }
const SOURCE: EditorField = {
  name: 'source',
  label: '外源',
  placeholder: '选择外源',
  default: DEFAULT_CHANGELOG_SOURCE,
}

/** 合法 WeatherLocation 形状(readWeatherLocation 校验:lat/lon 数字即可)。 */
const SH = { name: '上海', adm1: '上海市', adm2: '上海', lat: 31.23, lon: 121.47 }

describe('prefillFields(编辑预填)', () => {
  it('文本字段取 data 字符串,缺失回落空串', () => {
    expect(prefillFields([NAME, SYMBOL], { name: 'GitHub' })).toEqual({
      name: 'GitHub',
      symbol: '',
    })
  })

  it('location 走 readWeatherLocation:合法对象原样回填,非法/缺失回落空串', () => {
    expect(prefillFields([LOCATION], { location: SH })).toEqual({ location: SH })
    expect(prefillFields([LOCATION], { location: { lat: 'x' } })).toEqual({ location: '' })
    expect(prefillFields([LOCATION], null)).toEqual({ location: '' })
  })

  it('source:存量 data=null / 非法 id 回落生效源(默认源)——编辑弹层不再出现空串预填', () => {
    expect(prefillFields([SOURCE], null)).toEqual({ source: DEFAULT_CHANGELOG_SOURCE })
    expect(prefillFields([SOURCE], { source: 'not-a-source' })).toEqual({
      source: DEFAULT_CHANGELOG_SOURCE,
    })
  })

  it('source:合法 id 原样回填', () => {
    const other = CHANGELOG_SOURCES.find((s) => s.id !== DEFAULT_CHANGELOG_SOURCE)!
    expect(prefillFields([SOURCE], { source: other.id })).toEqual({ source: other.id })
  })

  it('空 fields → 空 values', () => {
    expect(prefillFields([], null)).toEqual({})
  })
})

describe('serializeFields(表单值 → data)', () => {
  it('空 editor 返回 null(changelog 等无配置类型)', () => {
    expect(serializeFields([], {})).toBeNull()
  })

  it('nav: 装配 name + url,url 走 normalizeUrl 补前缀', () => {
    expect(serializeFields([NAME, URL], { name: 'GitHub', url: 'github.com' })).toEqual({
      name: 'GitHub',
      url: 'https://github.com',
    })
  })

  it('各字段去首尾空白', () => {
    expect(serializeFields([NAME, URL], { name: '  GitHub  ', url: '  https://a.com  ' })).toEqual({
      name: 'GitHub',
      url: 'https://a.com',
    })
  })

  it('已有 https:// 前缀的 url 不重复补全', () => {
    expect(serializeFields([URL], { url: 'https://a.com' })).toEqual({ url: 'https://a.com' })
  })

  it('缺失字段按空串处理(不抛错)', () => {
    expect(serializeFields([NAME, URL], { name: 'X' })).toEqual({ name: 'X', url: '' })
  })

  it('stock: 装配 symbol + name(无 url 归一化)', () => {
    expect(serializeFields([SYMBOL, NAME], { symbol: 'usAAPL', name: '苹果' })).toEqual({
      symbol: 'usAAPL',
      name: '苹果',
    })
  })

  it('location:合法对象原样入 data;空串/缺失省略键', () => {
    expect(serializeFields([LOCATION], { location: SH })).toEqual({ location: SH })
    expect(serializeFields([LOCATION], { location: '' })).toEqual({})
    expect(serializeFields([LOCATION], {})).toEqual({})
  })

  it('source:trim 后入 data', () => {
    expect(serializeFields([SOURCE], { source: `  ${DEFAULT_CHANGELOG_SOURCE}  ` })).toEqual({
      source: DEFAULT_CHANGELOG_SOURCE,
    })
  })
})

describe('missingRequiredText(新增提交门)', () => {
  it('location 缺值返回臂声明的文案,有值返回 undefined', () => {
    expect(missingRequiredText([LOCATION], { location: '' })).toBe('请选择城市')
    expect(missingRequiredText([LOCATION], { location: SH })).toBeUndefined()
  })

  it('未声明 required 的字段不设门', () => {
    expect(missingRequiredText([NAME, URL, SOURCE], {})).toBeUndefined()
  })

  it('只看 fields 里声明的字段', () => {
    expect(missingRequiredText([NAME], {})).toBeUndefined()
  })
})
