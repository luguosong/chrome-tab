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

/**
 * 模型精选(CONTEXT.md「模型精选」):AIHOT 精选流 ×「模型发布」分类的条目级
 * 策展视图,数据形态 = 后端 AihotModelPickDto 直透(裁剪口径见 backend/src/aihot.ts)。
 */
export type AiHotModelPick = {
  id: string
  title: string
  sourceName: string | null
  /** AIHOT 站内阅读页(中文摘要 + 原文入口),Modal 主跳目标。 */
  aihotUrl: string | null
  /** 第三方原文出处,Modal 次链接。 */
  originalUrl: string | null
  publishedAt: string | null
}

/**
 * AI 日报(CONTEXT.md「AI 日报」):每早八时定稿的带日期快照,数据形态 = 后端
 * AihotDailyDto 直透(裁剪口径见 backend/src/aihot.ts)。条目无 id(区别于
 * items 流),React key 用 section/条目双下标——定稿列表渲染期不重排,安全。
 */
export type AiHotDailyItem = {
  title: string
  /** AI 综述摘要,日报核心价值,Modal 内全显。 */
  summary: string | null
  sourceName: string | null
  /** AIHOT 站内阅读页,Modal 主跳目标。 */
  aihotUrl: string | null
  /** 第三方原文出处,Modal 次链接。 */
  originalUrl: string | null
}

export type AiHotDaily = {
  /** 出刊日期(YYYY-MM-DD,北京时间)。 */
  date: string
  sections: { label: string; items: AiHotDailyItem[] }[]
}

/** 「2026-08-25」→「2026年8月25日 · 星期二」;非法输入原样返回(纯函数可直测)。 */
export function formatDailyDate(date: string): string {
  const d = new Date(`${date}T00:00:00`)
  if (Number.isNaN(d.getTime())) return date
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 · 星期${'日一二三四五六'[d.getDay()]}`
}
