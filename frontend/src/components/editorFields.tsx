import { Fragment, type ReactNode } from 'react'
import { CHANGELOG_SOURCES, changelogSourceOf } from 'chrome-tab-shared'
import type { EditorField } from '../lib/iconTypeRegistry'
import { extractString } from '../lib/iconData'
import { normalizeUrl } from '../lib/normalizeUrl'
import { readWeatherLocation, type WeatherLocation } from '../lib/weather'
import LocationPicker from './LocationPicker'
import SymbolPicker from './SymbolPicker'
import IconPicker from './IconPicker'

/**
 * 配置表单字段渲染 seam(ADR-0001 注记的第三件套;架构评审候选 B,2026-08-28)。
 *
 * EditorField(注册表,lib/iconTypeRegistry.ts)只声明「有什么字段」——label /
 * placeholder / default 元数据;每个**字段名**的渲染、编辑预填、序列化与必填语义
 * 收拢为本表的一臂。表为静态全覆盖 `Record<EditorField['name'], …>`:新增字段名漏写
 * 臂时类型检查即失败——「未知字段静默退化成自由文本」的漂移类缺陷(评审实证:
 * changelog 外源在编辑弹层退化为 input)从结构上不再可能。
 *
 * 消费方是两处薄声明:新增抽屉 TypeCard(AddDrawer.tsx)与编辑 popover EditForm
 * (Icon.tsx,GroupOverlay 组内子图标复用同一组件)——各自只持 values 状态、nav
 * 站点信息自动填充(类型级效果,非字段语义)与提交动作。icon 臂可上报本地处理
 * busy(图片上传),表单统一禁提交——新增侧此前缺这道门(评审发现的第三处漂移)。
 *
 * 渲染循环是薄 map(repo 惯例不测组件);prefillFields / serializeFields /
 * missingRequiredText 为纯函数,直接 Vitest 断言(editorFields.test.ts)。
 */

/** 字段控件渲染上下文。values/setField 供跨字段接线(symbol 选候选连带写 name、
 *  icon 臂读 url 做派生基准);onBusy 供本地处理耗时的字段上报 busy。 */
export interface FieldRenderContext {
  field: EditorField
  values: Record<string, unknown>
  setField: (name: string, v: unknown) => void
  onBusy?: (busy: boolean) => void
}

/** 一臂 = 一个字段名的全部表单语义:渲染 + 编辑预填 + 序列化 + 新增必填门。 */
export interface EditorFieldArm {
  /** 字段控件(add/edit 两路共用)。 */
  render(ctx: FieldRenderContext): ReactNode
  /** icon.data → 表单初值(编辑弹层打开瞬间的快照)。 */
  prefill(data: Record<string, unknown> | null, field: EditorField): unknown
  /** 表单值 → data 条目值;返回 undefined = 不入 data(location 空则省略)。 */
  serialize(value: unknown): unknown
  /** 新增提交门:该字段缺值时提交按钮显示的文案;undefined = 选填。 */
  required?: string
}

/** 文本臂的公共序列化:trim(缺失/非串回落空串,与退役的 buildIconData 同口径)。 */
function asTrimmedText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** 文本臂:name/url 等自由文本字段的公共形态;url 臂在其上覆写 serialize。 */
const textArm: EditorFieldArm = {
  render: ({ field, values, setField }) => (
    <input
      value={(values[field.name] as string) ?? ''}
      onChange={(e) => setField(field.name, e.target.value)}
      placeholder={field.placeholder}
      aria-label={field.label}
      className="w-full px-3 py-2 rounded-lg bg-white/20 text-white placeholder-white/50 text-sm outline-none focus:ring-2 focus:ring-accent"
    />
  ),
  prefill: (data, field) => extractString(data, field.name),
  serialize: asTrimmedText,
}

const urlArm: EditorFieldArm = {
  ...textArm,
  // 网址补 https:// 前缀(空串原样返回空,见 normalizeUrl)
  serialize: (value) => normalizeUrl(asTrimmedText(value)),
}

/** symbol 臂:标的检索(腾讯 smartbox);选候选连带写 name——规范名自动填,
 *  换候选覆盖,name 框仍可手改(跨字段接线,CONTEXT.md「自选股」)。 */
const symbolArm: EditorFieldArm = {
  render: ({ field, values, setField }) => (
    <SymbolPicker
      value={String(values[field.name] ?? '')}
      onText={(v) => setField(field.name, v)}
      onPick={(c) => {
        setField(field.name, c.symbol)
        setField('name', c.name)
      }}
      placeholder={field.placeholder}
    />
  ),
  prefill: (data, field) => extractString(data, field.name),
  serialize: asTrimmedText,
}

/** location 臂:天气城市选择器(和风 GeoAPI 只在选位置时用一次)。值是结构化
 *  WeatherLocation;序列化时空值不入 data;新增时必填(提交门文案)。
 *  编辑弹层无法清空位置(LocationPicker 不产 null),故 required 门只作用于新增。 */
const locationArm: EditorFieldArm = {
  render: ({ field, values, setField }) => (
    <LocationPicker
      value={values[field.name] ? (values[field.name] as WeatherLocation) : null}
      onChange={(loc) => setField(field.name, loc)}
      placeholder={field.placeholder}
    />
  ),
  prefill: (data) => readWeatherLocation(data) ?? '',
  serialize: (value) => (value ? value : undefined),
  required: '请选择城市',
}

/** icon 臂:nav 的「图标覆盖」选择器(CONTEXT.md「图标覆盖」:覆盖 > 派生 favicon,
 *  恢复自动 = 清空覆盖)。派生与站点信息候选以 url 为基准(跨字段读);本机图片
 *  处理耗时,经 onBusy 上报禁提交。 */
const iconArm: EditorFieldArm = {
  render: ({ field, values, setField, onBusy }) => (
    <IconPicker
      url={String(values['url'] ?? '')}
      value={String(values[field.name] ?? '')}
      onChange={(v) => setField(field.name, v)}
      onProcessingChange={onBusy}
      placeholder={field.placeholder}
    />
  ),
  prefill: (data, field) => extractString(data, field.name),
  serialize: asTrimmedText,
}

/** source 臂:更新日志外源下拉(ADR-0020,选项 = shared CHANGELOG_SOURCES 枚举)。
 *  预填走 changelogSourceOf 读侧兜底——存量 data=null 与非法 id 都显示生效源,
 *  编辑弹层从此与新增同款下拉、不再退化为自由文本。values 未设时回落声明 default
 *  (双保险,实际不可达:新增初值即 default,编辑预填必为合法 id)。 */
const sourceArm: EditorFieldArm = {
  render: ({ field, values, setField }) => {
    const initial = 'default' in field ? field.default : ''
    return (
      <select
        value={String(values[field.name] ?? initial)}
        onChange={(e) => setField(field.name, e.target.value)}
        aria-label={field.label}
        className="w-full px-3 py-2 rounded-lg bg-white/20 text-white text-sm outline-none focus:ring-2 focus:ring-accent"
      >
        {CHANGELOG_SOURCES.map((s) => (
          <option key={s.id} value={s.id} className="text-black">
            {s.label}
          </option>
        ))}
      </select>
    )
  },
  prefill: (data) => changelogSourceOf(data),
  serialize: asTrimmedText,
}

// ── 臂表(键 = 字段名,静态全覆盖;新增 EditorField 名字漏臂即 tsc 红)─────────
const ARMS: Record<EditorField['name'], EditorFieldArm> = {
  name: textArm,
  url: urlArm,
  symbol: symbolArm,
  location: locationArm,
  icon: iconArm,
  source: sourceArm,
}

/** 字段渲染循环(add/edit 两表单共用的唯一分派点)。 */
export function EditorFields({
  fields,
  values,
  setField,
  onBusyChange,
}: {
  fields: EditorField[]
  values: Record<string, unknown>
  setField: (name: string, v: unknown) => void
  onBusyChange?: (busy: boolean) => void
}) {
  return (
    <>
      {fields.map((f) => (
        <Fragment key={f.name}>
          {ARMS[f.name].render({ field: f, values, setField, onBusy: onBusyChange })}
        </Fragment>
      ))}
    </>
  )
}

/** 编辑预填:按各臂 prefill 从 icon.data 装配表单初值。纯函数——直接 Vitest 断言。 */
export function prefillFields(
  fields: EditorField[],
  data: Record<string, unknown> | null,
): Record<string, unknown> {
  return Object.fromEntries(fields.map((f) => [f.name, ARMS[f.name].prefill(data, f)]))
}

/** 序列化:表单值 → 图标 data(逐臂 serialize;undefined 条目省略)。
 *  editor 为空的类型(如 changelog 改绑前的 todo)返回 null(无 data)。
 *  纯函数——直接 Vitest 断言。 */
export function serializeFields(
  fields: EditorField[],
  values: Record<string, unknown>,
): Record<string, unknown> | null {
  if (fields.length === 0) return null
  const data: Record<string, unknown> = {}
  for (const f of fields) {
    const v = ARMS[f.name].serialize(values[f.name])
    if (v !== undefined) data[f.name] = v
  }
  return data
}

/** 新增提交门:返回第一个缺值 required 字段的按钮文案,全部就绪返回 undefined。
 *  纯函数——直接 Vitest 断言。 */
export function missingRequiredText(
  fields: EditorField[],
  values: Record<string, unknown>,
): string | undefined {
  for (const f of fields) {
    const required = ARMS[f.name].required
    if (required !== undefined && !values[f.name]) return required
  }
  return undefined
}
