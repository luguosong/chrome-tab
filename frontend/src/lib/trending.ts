/** 补译「在途」的判定窗:数据抓取时刻(或最近一次手动重试)距今 <5min 视为译文
 *  仍可能到来——行内挂「译文生成中」+ 15s 到达轮询;超窗仍有缺口即「暂未译出」,
 *  转顶部提示条 + 重试入口(与 staleTime 同量级,常量单点在此)。 */
export const TRENDING_TRANSLATE_FRESH_MS = 5 * 60_000

/**
 * 补译新鲜窗谓词(CONTEXT.md「GitHub 趋势」补译暂态的判别轴,轮询闸与徽章闸
 * 同源消费):锚点取 max(fetchedAt, retryAt)——retryAt 是手动「重试翻译」点击
 * 时刻,把窗口从抓取时刻拉回当下,让重试后的轮询复活。fetchedAt 缺失(wire
 * 形状防御,2026-08-27 事故口径)恒判窗外。纯函数,注入 now 可直测。
 */
export function isTranslateFresh(
  fetchedAt: string | undefined,
  retryAt: number,
  now: number = Date.now(),
): boolean {
  if (fetchedAt == null) return false
  return now - Math.max(Date.parse(fetchedAt), retryAt) < TRENDING_TRANSLATE_FRESH_MS
}
