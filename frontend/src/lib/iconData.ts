import type { EditorField } from './iconTypeRegistry'
import { normalizeUrl } from './normalizeUrl'

/**
 * 从图标 data(JSON 配置)取一个字符串字段。
 *
 * icon.data 是类型专属配置(nav={name,url} / stock={symbol,name} / changelog=null),
 * 各渲染层(Icon、StockModal)都要从中安全地取字符串。集中一处避免重复。
 */
export function extractString(
  data: Record<string, unknown> | null,
  key: string,
): string {
  if (!data) return ''
  const v = data[key]
  return typeof v === 'string' ? v : ''
}

/**
 * 把编辑器表单值装配成图标 data。新增抽屉(issue 09)与编辑模式配置 popover 共用。
 *
 * - `url` 字段走 {@link normalizeUrl}(补 https:// 前缀,见 spec user story 22);
 * - `location` 字段(天气城市选择器)是结构化对象(WeatherLocation),原样存入 data.location;
 * - 其余字符串字段 `trim`;
 * - editor 为空的类型(如 changelog)返回 null(无 data)。
 *
 * 抽为纯函数以便 Vitest 断言,并使「新增」与「编辑」两条提交路径共用同一份归一化逻辑,
 * 避免漂移。
 */
export function buildIconData(
  fields: EditorField[],
  values: Record<string, unknown>,
): Record<string, unknown> | null {
  if (fields.length === 0) return null
  const data: Record<string, unknown> = {}
  for (const f of fields) {
    if (f.name === 'location') {
      const v = values[f.name]
      if (v) data['location'] = v // WeatherLocation 对象
    } else {
      const raw = values[f.name]
      const v = (typeof raw === 'string' ? raw : '').trim()
      data[f.name] = f.name === 'url' ? normalizeUrl(v) : v
    }
  }
  return data
}
