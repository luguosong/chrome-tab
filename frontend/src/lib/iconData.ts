/**
 * 从图标 data(JSON 配置)取一个字符串字段。
 *
 * icon.data 是类型专属配置(nav={name,url,icon?} / stock={symbol,name} / weather={location} /
 * changelog={source}),各渲染层(Icon、StockModal)都要从中安全地取字符串。集中一处避免重复。
 */
export function extractString(
  data: Record<string, unknown> | null,
  key: string,
): string {
  if (!data) return ''
  const v = data[key]
  return typeof v === 'string' ? v : ''
}

/** nav 的 favicon 服务地址:沿用旧 NavTileGroup 的 google s2 favicons。
 *  网格 Icon、组图标预览(GroupBody)与分组弹层子图标(GroupOverlay)共用。 */
export function faviconUrl(url: string): string {
  try {
    const domain = new URL(url).hostname
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`
  } catch {
    return ''
  }
}

/**
 * nav 图标实际渲染的图标地址(渲染优先级,见 CONTEXT.md「图标覆盖」):
 * 手动覆盖(data.icon,用户在表单选定/手输的图片地址)> 派生 favicon(由 url 即时派生)。
 * 两者皆无 → ''(调用方不渲染图形)。三个渲染消费点(Icon 网格 / GroupBody 预览 /
 * GroupOverlay 弹层)统一走这里,避免覆盖逻辑漂移。
 */
export function navIconSrc(data: Record<string, unknown> | null): string {
  const override = extractString(data, 'icon').trim()
  if (override) return override
  const url = extractString(data, 'url')
  return url ? faviconUrl(url) : ''
}
