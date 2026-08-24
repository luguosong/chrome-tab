/**
 * 待办(CONTEXT.md「待办」)的前端类型与纯函数。数据形态 = 后端 TodoTaskDto
 * 的直透(见 backend/src/dida.ts,字段裁剪的唯一口径);null = 从未取到。
 */
export type TodoTask = {
  id: string
  projectId: string
  title: string
  /** 0 无 1 低 3 中 5 高(滴答原值)。 */
  priority: number
  /** 到期时间(ISO,滴答原串带偏移);今日+过期口径下必有,null 兜底。 */
  dueDate: string | null
}

const p2 = (n: number) => String(n).padStart(2, '0')
/** 毫秒 → +08 时区的「年-月-日」键(服务器/客户端时区无关,与后端口径同源)。 */
const dayKeyPlus8 = (ms: number): string => {
  const t = new Date(ms + 8 * 3_600_000)
  return `${t.getUTCFullYear()}-${p2(t.getUTCMonth() + 1)}-${p2(t.getUTCDate())}`
}
const hmPlus8 = (ms: number): string => {
  const t = new Date(ms + 8 * 3_600_000)
  return `${p2(t.getUTCHours())}:${p2(t.getUTCMinutes())}`
}

/**
 * 到期标签(纯函数可直测):同一 +08 日 → HH:mm;早于今日 → 过期N天;
 * 未来(口径外防御)→ HH:mm。null → ''。
 */
export function dueLabel(dueDate: string | null, now = new Date()): string {
  if (!dueDate) return ''
  const ms = new Date(dueDate).getTime()
  if (!Number.isFinite(ms)) return ''
  const diffDays = Math.round(
    (new Date(dayKeyPlus8(now.getTime())).getTime() - new Date(dayKeyPlus8(ms)).getTime()) / 86_400_000,
  )
  if (diffDays <= 0) return hmPlus8(ms)
  return `过期${diffDays}天`
}

/** 过期判定(dueLabel 的布尔伴生,红色样式用)。 */
export function isOverdue(dueDate: string | null, now = new Date()): boolean {
  if (!dueDate) return false
  const ms = new Date(dueDate).getTime()
  return Number.isFinite(ms) && dayKeyPlus8(ms) < dayKeyPlus8(now.getTime())
}
