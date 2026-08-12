/**
 * 走马灯翻页的目标页解析(环形 / wraparound,见 ADR-0008)。
 *
 * 滚轮与左右方向键等"±1"导航在越界时首尾相接:首页往上→末页,末页往下→首页。
 * 返回目标页索引 + 是否发生了环形(供 Carousel.goTo 决定动画策略——环形瞬间到位,
 * 非环形沿用 easeOutBack 位置滑动)。
 *
 * - 非环形输入(0 <= i < count,如 PageTabs 绝对下标点击)原样返回,isWrap=false。
 * - 越界(i < 0 或 i >= count)按取模环形,isWrap=true。
 * - 空页集(count <= 0)返回 null——调用方应直接 return。
 *
 * 纯函数、无 DOM:环形取模含负数修正((((i % count) + count) % count))与边界判定
 * 是 off-by-one 高发区,故抽出单独覆盖(见 carouselNav.test.ts)。
 */
export function resolveWrapPage(
  i: number,
  count: number,
): { pageIndex: number; isWrap: boolean } | null {
  if (count <= 0) return null
  const isWrap = i < 0 || i >= count
  const pageIndex = ((i % count) + count) % count
  return { pageIndex, isWrap }
}
