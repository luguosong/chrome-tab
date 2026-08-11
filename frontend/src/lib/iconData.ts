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
