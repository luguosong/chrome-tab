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

/**
 * 相邻环形的连续滑动计划(修订 ADR-0008:末页→首页/首页→末页从瞬间跳切改为
 * 克隆页单步滑动,消除"闪回"感)。
 *
 * 走马灯 DOM 首尾各有一个克隆位 slide:索引空间 [0=左克隆位, 1..count=真页,
 * count+1=右克隆位](真页 i 的 slide 索引 = i+1,故所有 scrollLeft 都带 +1 页偏移)。
 * 相邻环形时:把目标页 DOM 快照克隆进对应克隆位 → 弹簧动画滑过去(视觉 = 连续翻一页)
 * → 落定后无动画瞬移回真页位(克隆位与真位内容相同,瞬移无感)。
 *
 * 仅"逻辑相邻"的环形可这样滑(末页→首页、首页→末页);多步越界(如 i=count+1)物理
 * 跨度 > 1 页,滑动会扫过中间页,返回 null——调用方回落 instant cut(ADR-0008 原行为)。
 *
 * @param pageIndex resolveWrapPage 解析出的目标逻辑页(0..count-1)
 * @param active    当前逻辑页
 * @param count     总页数
 * @returns 克隆源真页号 + 动画落点 slide 索引(slideTo) + 复位真页 slide 索引(settleTo);
 *          调用方把 slide 索引乘页宽得 scrollLeft。不可滑动时 null。
 */
export function wrapSlidePlan(
  pageIndex: number,
  active: number,
  count: number,
): { cloneFrom: number; slideTo: number; settleTo: number } | null {
  if (count <= 1) return null // 单页:环形回自身,无需克隆
  const adjacent =
    (pageIndex === 0 && active === count - 1) || // 末页 +1 → 首页
    (pageIndex === count - 1 && active === 0) // 首页 -1 → 末页
  if (!adjacent) return null
  return pageIndex === 0
    ? { cloneFrom: 0, slideTo: count + 1, settleTo: 1 } // 首页快照滑入右克隆位,复位真首页
    : { cloneFrom: count - 1, slideTo: 0, settleTo: count } // 末页快照滑入左克隆位,复位真末页
}
