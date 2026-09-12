import type { NavPayload } from './iconTypeRegistry'

/** nav 的 favicon 服务地址:沿用旧 NavTileGroup 的 google s2 favicons。
 *  网格 Icon、组图标预览(GroupBody)与分组弹层子图标(GroupOverlay)共用;
 *  另有非图标载荷消费点(IconPicker 派生候选、LeaderboardPanel 厂家 logo)。 */
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
 * 手动覆盖(payload.icon,用户在表单选定/手输的图片地址)> 派生 favicon(由 url 即时派生)。
 * 两者皆无 → ''(调用方不渲染图形)。三个渲染消费点(Icon 网格 / 组预览 /
 * 分组弹层子图标)统一走这里,避免覆盖逻辑漂移。入参是 nav 载荷(ADR-0059
 * codec decode 的产物),依赖面只 url/icon 两字段。
 */
export function navIconSrc(payload: Pick<NavPayload, 'url' | 'icon'> | null): string {
  const override = payload?.icon?.trim() ?? ''
  if (override) return override
  return payload?.url ? faviconUrl(payload.url) : ''
}
