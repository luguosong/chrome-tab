/**
 * AI 热点(CONTEXT.md「AI 热点」)的前端类型与纯函数。数据形态 = 后端
 * AihotTopicDto 的直透(见 backend/src/aihot.ts,字段裁剪的唯一口径);null = 从未取到。
 */
export type AiHotTopic = {
  rank: number
  title: string
  sourceName: string | null
  /** AIHOT 站内事件页(时间线 + AI 综述),Modal 主跳目标。 */
  storyUrl: string | null
  /** 原文出处,Modal 次链接。 */
  originalUrl: string | null
  sourceCount: number
  latestAt: string | null
}

/** 最新报道时间的相对时长(「刚刚/N 分钟前/N 小时前/N 天前」);无法解析返回空串。纯函数可直测。 */
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
