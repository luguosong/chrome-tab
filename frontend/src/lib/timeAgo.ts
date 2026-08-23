/** 最新报道/发布时间的相对时长(「刚刚/N 分钟前/N 小时前/N 天前」);无法解析返回空串。
 *  纯函数可直测;aihot 榜单鲜度与 changelog 版本榜共用(ADR-0022 前从 lib/aihot 移入中立位)。 */
export function timeAgo(iso: string | null, now = Date.now()): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const diff = now - t
  if (diff < 60_000) return '刚刚'
  const min = Math.floor(diff / 60_000)
  if (min < 60) return `${min} 分钟前`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour} 小时前`
  return `${Math.floor(hour / 24)} 天前`
}
