/**
 * 「块内主体」纯规则(见 CONTEXT.md「块内主体」):行数渲染窗经 TileBody 作用于
 * 五家大 tile;红点判定(ISO/秒/毫秒三形态)由三家 tile body(更新日志/视频/新闻)
 * 与两处 Modal 列表消费——模型行动态鲜度是域规则(isFreshModelEvent),不在此列。
 * 组件零件(容器/行壳/红点)在 components/TileBody.tsx;本文件只放可测的纯决策。
 */

/** 榜单最多渲染行数:全量 300+ 条 DOM 无谓(看全量走「更多」Modal),30 行远超 tile 滚动可读量。 */
export const TILE_ROW_CAP = 30

/** 新条目红点窗口:发布 <24h 的行带红点;时间驱动、满窗自隐、无已读概念。 */
export const NEW_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * 24h 红点判定的唯一执行口径(全仓唯一 NEW_WINDOW_MS 消费方)。输入三形态都吃
 * ——更新日志给 ISO 串,视频/新闻的 wire 给秒级时间戳:
 *  - ISO 8601 字符串(new Date 可解析)
 *  - 秒级数值(Unix seconds)
 *  - 毫秒级数值(Unix ms)
 *
 * 数字型秒/毫秒无法从类型读出,按量级阈值区分:秒级时间戳到 2286 年(10¹¹ 秒)
 * 都不足 1e11,毫秒级时间戳自 1970-03 起即 ≥ 1e11,两域在可预见未来互不越界。
 * 非法/缺失输入(空串/null/undefined/NaN/Invalid Date)回落 false——宁不标红,
 * 勿误标(同「宁原文勿空」的降级语感)。
 */
export function isFreshRow(at: string | number | null | undefined): boolean {
  if (at === null || at === undefined || at === '') return false
  const ms = typeof at === 'string' ? new Date(at).getTime() : at < 1e11 ? at * 1000 : at
  return Number.isFinite(ms) && Date.now() - ms < NEW_WINDOW_MS
}
