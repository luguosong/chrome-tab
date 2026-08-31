/**
 * 悬浮宽限状态机(CONTEXT.md「悬浮宽限」):hover 浮层的显隐手势单点,
 * 时钟弹层与「待办」快览卡两宿主共用。本体是计时语义——250ms 宽限 + 几何
 * 联合判定 + 150ms 重拍续期,故计时在 lib(注入 timer 可表驱动),区别于
 * 拖拽 dwell 计时留在接线 hook 的先例(那是附属反馈,见 ADR-0047 判别轴)。
 * 零 React 依赖;指针追踪与门槛位移累计由 pointerMove 驱动(接线 hook 挂
 * 全局 mousemove 喂入)。
 */

/** 判定盒:只读四边(DOMRect 结构兼容,测试可给字面量)。 */
export type GraceBox = { left: number; top: number; right: number; bottom: number }

/** 注入时钟:默认真 setTimeout,测试拨手动时钟。 */
export type GraceTimer = {
  set(fn: () => void, ms: number): unknown
  clear(handle: unknown): void
}
const defaultTimer: GraceTimer = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
}

export function createHoverGrace<T>(config: {
  /** 显示(或重显:指针抖动重进触发区,快照更新)。 */
  onShow: (payload: T) => void
  /** 收起。只在已显示时触发一次(visible 门保证幂等)。 */
  onHide: () => void
  /** 浮层盒(判定时实时读;null = 浮层未挂载,判区外)。 */
  getFloatingRect: () => GraceBox | null
  /** 首次交互门槛(px):累计位移不足不显示,防刷新后静置指针压在触发元素上幽灵触发;0 = 不设门槛。 */
  moveGatePx?: number
  timer?: GraceTimer
}) {
  const gatePx = config.moveGatePx ?? 0
  const timer = config.timer ?? defaultTimer
  let traveled = 0
  let last: { x: number; y: number } | null = null
  let pointer = { x: -1, y: -1 }
  let visible = false
  let hideHandle: unknown
  let triggerBox: GraceBox | null = null

  /** 指针在「触发盒∪浮层盒」外接矩形内(间隙在内不断链——宽限期几何判定的本体)。 */
  const inZone = () => {
    const f = config.getFloatingRect()
    if (!f || !triggerBox) return false
    const { x, y } = pointer
    return (
      x >= Math.min(triggerBox.left, f.left) && x <= Math.max(triggerBox.right, f.right) &&
      y >= Math.min(triggerBox.top, f.top) && y <= Math.max(triggerBox.bottom, f.bottom)
    )
  }
  const hide = () => {
    if (!visible) return
    visible = false
    config.onHide()
  }

  return {
    /** 指针移动(接线层喂 mousemove);首帧只记基准,之后累计曼哈顿位移。 */
    pointerMove(x: number, y: number) {
      if (last) traveled += Math.abs(x - last.x) + Math.abs(y - last.y)
      last = { x, y }
      pointer = { x, y }
    },

    /** 进触发区:过门槛才显示,并作废旧宽限计时(mouseenter 早于 mousemove 派发,
     *  读到的是「到达前」累计,语义自洽;重进=重显,快照更新)。 */
    enter(payload: T) {
      if (traveled < gatePx) return
      timer.clear(hideHandle)
      visible = true
      config.onShow(payload)
    },

    /** 离触发区:250ms 宽限,到期判几何——仍在联合矩形内以 150ms 重拍续期,真离开才收。 */
    leave(rect: GraceBox) {
      triggerBox = rect
      timer.clear(hideHandle)
      hideHandle = timer.set(function tick() {
        if (inZone()) hideHandle = timer.set(tick, 150)
        else hide()
      }, 250)
    },

    /** 浮层自身 mouseenter:取消待收计时(portal 浮层不在触发元素子树,事件自持)。 */
    stay() {
      timer.clear(hideHandle)
    },

    /** 即时收起(清计时):宿主域收口统一入口——快览卡的数据变/切页/滚动/点行。 */
    close() {
      timer.clear(hideHandle)
      hide()
    },

    /** 卸载清理:只清计时,不触发收起回调(组件将不存在)。 */
    dispose() {
      timer.clear(hideHandle)
    },
  }
}
