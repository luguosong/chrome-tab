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

// timeAgo 已移至 lib/timeAgo.ts(ADR-0022:changelog 版本榜共用,中立位)。
