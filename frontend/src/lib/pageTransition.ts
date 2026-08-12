/**
 * 翻页动画的逐帧位移分解(修复:首/末页回弹被浏览器夹掉)。
 *
 * 原实现把 easeOutBack 的"越界回弹"烘进 scrollLeft 一并赋值,但 scrollLeft 被浏览器
 * 夹在 [0, scrollWidth-clientWidth]——切到首页(目标 0)或末页(目标 max)时,回弹要越界
 * 的那一段被静默抹平,只有中间页看得到回弹。
 *
 * 拆成两路:
 *   - scrollLeft 走 easeOutCubic 单调到位,恒在 [start, target] 内、永不越界 → 首末页不再被夹;
 *   - 越界回弹量交给 CSS transform(translateX 作用在每页内容上,不受 scrollLeft 边界限制)。
 *
 * 合成视觉与原 easeOutBack 等价。推导:令"新视觉位移 = 原视觉位移",
 *   -(start + distance·cubic) + translateX = -(start + distance·back)
 *   ⇒ translateX = distance·(cubic - back)
 * 纯函数、无 DOM;逐帧不变量(永不越界)由 pageTransition.test.ts 锁定,防回归到"回弹烘进 scrollLeft"。
 */
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)
const easeOutBack = (t: number, c1 = 1.7) => {
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}

/**
 * 计算翻页动画第 t(0..1)帧的位移分解。
 * @returns scrollLeft 应赋的像素值(单调,在 [start,target] 内);overshoot 应作为
 *          translateX 作用在页内容上的像素值(t=0 与 t=1 处为 0,中间为越界回弹量)。
 */
export function pageTransitionFrame(
  t: number,
  start: number,
  distance: number,
): { scrollLeft: number; overshoot: number } {
  const cubic = easeOutCubic(t)
  return {
    scrollLeft: start + distance * cubic,
    overshoot: distance * (cubic - easeOutBack(t)),
  }
}
