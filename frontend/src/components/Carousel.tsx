import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useDndContext, useDroppable } from '@dnd-kit/core'
import PageTabs from './PageTabs'
import { resolveWrapPage, wrapSlidePlan } from '../lib/carouselNav'
import { pageTransitionFrame } from '../lib/pageTransition'
import { EDGE_DROP_ID } from '../lib/iconDrag'

/**
 * 走马灯：基于 CSS scroll-snap，原生顺滑、自带触控/触控板支持。
 * - 横向滚动 + snap-x mandatory，每页宽度 = 容器宽度
 * - 常驻 PageTabs 页签条(切换/重排/管理,见 PageTabs);翻页入口 = 页签/滚轮/键盘/触控滑动
 *   (全局 ‹ › 箭头已移除——与页签同功能冗余,2026-08-27 测试报告 #8)
 * - 滚轮纵向 → 翻页(阻止页面内滚动,见 CONTEXT.md「页面」:固定画布;例外——
 *   跨格大 tile 的滚动主体内部优先消化滚轮、到边即停,不链式翻页,见 wheel 守卫)
 * - 键盘 ←/→ 翻页
 * - 滚轮/方向键越界时首尾环形相接(首页↑→末页,末页↓→首页):相邻环形经克隆位
 *   连续滑动(修订 ADR-0008),多步越界瞬间跳切;跨页拖拽不环形
 * - scroll 事件同步激活页
 * - 翻页用 rAF 弹簧曲线(easeOutBack)回弹落定,更灵动;回弹无视 prefers-reduced-motion(核心切换反馈,产品决策)
 *
 * 克隆位(CloneSlot):DOM 首尾各一个占位 slide(非 snap 点、平时空且不可见),
 * 使真页 i 的 slide 索引 = i+1、所有 scrollLeft 带 +1 页偏移。相邻环形翻页时把
 * 目标页 DOM 快照(cloneNode,纯 DOM——不进 React/dnd-kit,无 droppable id 冲突)
 * 填进对应克隆位,弹簧滑过去后无动画瞬移回真页位(两处内容相同,无感)。
 */

/** 接近区宽度(外层):光标进入此范围开始淡入方块(px)。仅视觉提示,不翻页。 */
const APPROACH_PX = 120
/** 进入方块后充能→翻页的停留时间(spec user story 31 「约 400ms」)。 */
const DWELL_MS = 400

interface CarouselApi {
  /** 当前激活页索引(供 PageTabs 高亮等读取) */
  active: number
  /** 总页数(issue 07:边缘自动翻页需要判断是否到边界) */
  count: number
  /** 翻到第 i 页(±1 越界时首尾环形相接,见 ADR-0008;跨页拖拽仍由 EdgeDropZone 自管截断) */
  goTo: (i: number) => void
}

const CarouselApiContext = createContext<CarouselApi>({
  active: 0,
  count: 0,
  goTo: () => {},
})

/** 子页面用：读取当前页索引 + 控制翻页 */
export function useCarousel() {
  return useContext(CarouselApiContext)
}

interface CarouselProps {
  /** 各页标题，用于 slide 的 aria-label(页签名由 PageTabs 自取 useConfig) */
  labels: string[]
  children: ReactNode[]
  /**
   * 滚动停稳后激活页变化时回调(issue 09 新增抽屉需要知道当前页以 POST 新图标)。
   * 可选——不传则 Carousel 仅内部维护激活态。保持非受控:不接收外部 active 回填,
   * 仅向上通知,避免与 scroll 派生状态形成双向同步。
   */
  onActiveChange?: (index: number) => void
}

export default function Carousel({ labels, children, onActiveChange }: CarouselProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(0)

  // 回弹翻页动画的 rAF 句柄。goTo 不再用原生 scrollTo(smooth),而是 rAF 驱动的
  // easeOutBack 弹簧曲线:到达目标后略微越界再回弹,「落定」手感更灵动。
  // 新调用会取消在飞动画并从当前位置重新瞄准(连续滚轮连翻不卡顿)。
  const animRef = useRef<number | null>(null)
  // 克隆位 slide(首/尾各一,结构见 CloneSlot)。环形连续滑动时往里填目标页 DOM 快照。
  const leftSlotRef = useRef<HTMLDivElement>(null)
  const rightSlotRef = useRef<HTMLDivElement>(null)

  const goTo = useCallback(
    (i: number) => {
      const el = ref.current
      if (!el) return
      // 环形解析(ADR-0008):±1 越界首尾相接,PageTabs 绝对下标则在范围内原样返回。
      // 跨页拖拽(EdgeDropZone)不经过这里——它自管边界截断,保持非环形。
      const resolved = resolveWrapPage(i, labels.length)
      if (!resolved) return // 空页集
      const { pageIndex, isWrap } = resolved
      // 真页 i 的 slide 索引 = i+1(首 slide 被左克隆位占据,所有 scrollLeft 带 +1 页偏移)
      const target = (pageIndex + 1) * el.clientWidth

      // 清空克隆位(填快照与中断归位两处共用)
      const clearSlots = () => {
        for (const slot of [leftSlotRef.current, rightSlotRef.current]) {
          if (!slot) continue
          slot.style.visibility = 'hidden'
          slot.firstElementChild?.replaceChildren()
        }
      }

      // 取消在飞的弹簧动画,并恢复 scroll-snap / scroll-behavior
      const resetOverrides = () => {
        el.style.scrollSnapType = ''
        el.style.scrollBehavior = ''
        el.style.setProperty('--pg-overshoot', '0px')
      }
      if (animRef.current != null) {
        cancelAnimationFrame(animRef.current)
        animRef.current = null
        // 环形滑动被打断且恰好停在克隆区时,先无感归位到同内容的真页位
        // (克隆位与真位内容相同,瞬移不可见),新动画才能从真位正确起步。
        const w = el.clientWidth
        const rawSlot = Math.round(el.scrollLeft / w)
        if (rawSlot === 0) el.scrollLeft = labels.length * w // 左克隆区 → 真末页
        else if (rawSlot === labels.length + 1) el.scrollLeft = w // 右克隆区 → 真首页
        clearSlots()
        resetOverrides()
      }

      // 回弹是用户明确要求的核心切换反馈,故无视 prefers-reduced-motion(产品决策)。
      // 已在目标位置则不动画。
      if (target === el.scrollLeft) {
        el.scrollLeft = target
        return
      }

      // 回弹分两路(pageTransitionFrame,见 lib/pageTransition.ts):scrollLeft 走 easeOutCubic
      // 单调到位(永不越界 → 首/末页不再被浏览器夹掉回弹),越界回弹量交给 CSS 变量
      // --pg-overshoot,由每页内容的 translateX 承担(transform 不受 scrollLeft 边界限制)。
      // 合成视觉与原 easeOutBack 等价。560ms 落定。
      // 动画期间必须同时关掉两项,否则回弹被吃掉:
      //   - scroll-snap-type: none —— mandatory 会把越界位置立刻拽回 snap 点
      //   - scroll-behavior: auto —— 容器带 scroll-smooth,smooth 会对「逐帧 scrollLeft 赋值」
      //     再做一次平滑插值,直接抹平回弹
      const springTo = (targetPx: number, onDone?: () => void) => {
        const start = el.scrollLeft
        const distance = targetPx - start
        el.style.scrollSnapType = 'none'
        el.style.scrollBehavior = 'auto'
        const duration = 560
        const t0 = performance.now()
        const tick = (now: number) => {
          const t = Math.min(1, (now - t0) / duration)
          const { scrollLeft, overshoot } = pageTransitionFrame(t, start, distance)
          el.scrollLeft = scrollLeft
          el.style.setProperty('--pg-overshoot', `${overshoot}px`)
          if (t < 1) {
            animRef.current = requestAnimationFrame(tick)
          } else {
            animRef.current = null
            el.scrollLeft = targetPx // 落到精确像素(= snap 点 / 克隆位点)
            onDone?.()
            resetOverrides() // 恢复:snap-x mandatory + scroll-smooth + --pg-overshoot=0
          }
        }
        animRef.current = requestAnimationFrame(tick)
      }

      // 环形(ADR-0008,2026-08 修订):相邻环形(末页+1→首页 / 首页-1→末页)改为
      // 连续滑动——把目标页 DOM 快照克隆进克隆位,弹簧滑过去(视觉 = 翻一页),
      // 落定后无动画瞬移回真页位(两处内容相同,瞬移无感)。多步越界(物理跨度 > 1 页,
      // 滑动会高速扫过中间页)与单页 no-op 仍走瞬间跳切。
      if (isWrap) {
        const plan = wrapSlidePlan(pageIndex, active, labels.length)
        if (!plan) {
          el.scrollLeft = target
          return
        }
        const w = el.clientWidth
        // 克隆源 = 真页 slide 的内层 div(不含 snap-center 外壳,免得克隆件变成 snap 点);
        // 落点 = 对应侧克隆位。DOM 结构意外时兜底回落瞬间跳切。
        const srcSlide = el.children[plan.cloneFrom + 1]
        const slot = plan.slideTo === 0 ? leftSlotRef.current : rightSlotRef.current
        if (!srcSlide?.firstElementChild || !slot?.firstElementChild) {
          el.scrollLeft = target
          return
        }
        const snapshot = srcSlide.firstElementChild.cloneNode(true) as HTMLElement
        snapshot.style.transform = '' // 快照静止,不吃动画期的 --pg-overshoot
        const slotInner = slot.firstElementChild as HTMLElement
        slotInner.replaceChildren(snapshot)
        slot.style.visibility = 'visible'
        springTo(plan.slideTo * w, () => {
          el.scrollLeft = plan.settleTo * w // 无感瞬移:克隆位与真位内容相同
          clearSlots()
        })
        return
      }

      springTo(target)
    },
    [labels.length, active],
  )

  // 卸载时取消在飞动画,避免 rAF 回调操作已卸载节点
  useEffect(
    () => () => {
      if (animRef.current != null) cancelAnimationFrame(animRef.current)
    },
    [],
  )

  // 页数变化时(删页/重排后)夹住 active,防止索引越界指向已不存在的页。
  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, labels.length - 1)))
  }, [labels.length])

  // 挂载与页数变化时校准 scrollLeft 到真页区(slide 索引 [1, count],见 CloneSlot 偏移):
  // 挂载时从 0 拉到真首页;删页后夹回末真页,防止停留在已消失的位置。
  // useLayoutEffect:paint 前执行,首帧不闪左克隆位。
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || el.clientWidth === 0) return
    const slide = Math.min(Math.max(Math.round(el.scrollLeft / el.clientWidth), 1), labels.length)
    el.scrollLeft = slide * el.clientWidth
  }, [labels.length])

  // scroll → 激活页同步。原始 slide 索引(= scrollLeft/页宽)带 +1 克隆位偏移,减 1 后
  // 落在克隆区(-1 / count)的经环形解析映射回对端真页——环形滑动动画中途派生出的
  // 已是目标页,与视觉一致。
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let raf = 0
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const raw = Math.round(el.scrollLeft / el.clientWidth) - 1
        const i = resolveWrapPage(raw, labels.length)?.pageIndex ?? active
        if (i !== active) {
          setActive(i)
          onActiveChange?.(i)
        }
      })
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(raf)
    }
  }, [active, labels.length, onActiveChange])

  // 滚轮翻页(CONTEXT.md「页面」:滚轮用于页间切换,而非页内滚动;例外——跨格大
  // tile 的滚动主体,ADR-0021/0022)。只接管"纵向滚轮"(常规鼠标):deltaY 占主导时
  // 翻页并 preventDefault;横向(触控板横扫 |deltaX|≥|deltaY|)交给原生 snap。
  // 400ms 节流防一次手势连翻多页。与 06/07 图标拖拽的 PointerSensor 不冲突:
  // wheel 与 pointer 是不同事件流。
  const lastWheel = useRef(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    // target 起的祖先链(不含走马灯容器自身)里有「纵向可滚」的元素(大 tile 版本榜/
    // 热点流/收集箱)→ 一律放行原生滚动:滚轮归滚动主体彻底消化,到边即停,不链式翻页
    // ——浏览器滚动链在 h-screen overflow-hidden 画布上无纵向可滚祖先,自然终止;想翻页
    // 把指针移到 tile 外。preventDefault 会取消整个冒泡路径的原生滚动,故必须在祖先
    // 监听里让路,而不是 tile 侧 stopPropagation 硬切。
    const inScrollableTile = (target: EventTarget | null): boolean => {
      for (let n = target as Element | null; n && n !== el; n = n.parentElement) {
        if (/(auto|scroll)/.test(getComputedStyle(n).overflowY) && n.scrollHeight > n.clientHeight) {
          return true
        }
      }
      return false
    }
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return // 横向交给原生
      if (inScrollableTile(e.target)) return
      e.preventDefault()
      const now = Date.now()
      if (now - lastWheel.current < 400) return
      lastWheel.current = now
      goTo(active + (e.deltaY > 0 ? 1 : -1))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [active, goTo])

  // 键盘翻页
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      // 输入框内不拦截方向键
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      // Modal/抽屉打开时不翻背后的走马灯:焦点落在对话框内时方向键属于对话框
      if ((e.target as HTMLElement)?.closest?.('[role="dialog"]')) return
      if (e.key === 'ArrowLeft') {
        goTo(active - 1)
        e.preventDefault()
      } else if (e.key === 'ArrowRight') {
        goTo(active + 1)
        e.preventDefault()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, goTo])

  return (
    <CarouselApiContext.Provider value={{ active, count: labels.length, goTo }}>
      {/* h-full + flex-col:翻页区 flex-1 填满,PageTabs 在底部常驻。
          高度链贯通到 slide → IconGrid(h-full),使图标区背景高度固定、不随图标数量变化。 */}
      <div className="relative w-full h-full flex flex-col">
        {/* 翻页区 */}
        <div
          ref={ref}
          className="no-scrollbar flex overflow-x-auto snap-x snap-mandatory scroll-smooth flex-1 min-h-0"
          aria-roledescription="carousel"
        >
          <CloneSlot ref={leftSlotRef} />
          {children.map((child, i) => (
            <div
              key={i}
              className="w-full shrink-0 snap-center h-full"
              aria-roledescription="slide"
              aria-label={labels[i]}
            >
              {/* 回弹越界由 translateX(--pg-overshoot) 承担(goTo 逐帧设置);放在内层而非
                  snap 子元素上,使 snap-child 休息态无 transform,避免干扰原生 snap 落点。 */}
              <div
                className="h-full px-4 sm:px-16"
                style={{ transform: 'translateX(var(--pg-overshoot, 0px))' }}
              >
                {child}
              </div>
            </div>
          ))}
          <CloneSlot ref={rightSlotRef} />
        </div>

        {/* 常驻页签条:切换/重排/增删改页面(替换原圆点指示器,页签条信息更丰富) */}
        <PageTabs />

        {/* 拖拽到屏幕左右边缘自动翻页(issue 07 / spec user story 31)。
            仅在 DnD 拖拽进行中挂载,避免无拖拽时占据边缘点击区。停留 400ms 翻一页到相邻页;
            单次进入只翻一页(惰性翻页),离开边缘再重新进入才翻下一页,避免贴边连冲到末页。 */}
        <EdgeDropZone side="left" />
        <EdgeDropZone side="right" />
      </div>
    </CarouselApiContext.Provider>
  )
}

/**
 * 环形连续滑动的克隆位 slide(修订 ADR-0008)。占 DOM 首尾各一:
 * - 常驻占宽(否则左克隆位出现时会把全部真页右推一页,scrollLeft 错位);
 * - 不带 snap-center —— 不是 snap 点,原生触控板横扫不会停在它上面(边界行为同旧版);
 * - 平时空且 visibility:hidden;环形翻页时 goTo 填入目标页 DOM 快照再显形。
 * 内层只挂高度链——快照本身就是真页内层 div(自带 px 页边距),整块塞入即逐像素
 * 同构,边距单层不翻倍。
 */
const CloneSlot = forwardRef<HTMLDivElement>(function CloneSlot(_props, ref) {
  return (
    <div
      ref={ref}
      aria-hidden
      className="w-full shrink-0 h-full"
      style={{ visibility: 'hidden' }}
    >
      <div className="h-full" />
    </div>
  )
})

/**
 * 拖拽时的左右边缘翻页方块(issue 07 / spec user story 31,2026-08-12 可见化改版)。
 * 挂在 Carousel 内部(可读 useCarousel + useDndContext)。
 *
 * 两层模型:
 *   - 外层 ~120px「接近区」:全局 pointermove 按光标到屏幕边的距离算 proximity(0..1),
 *     驱动方块淡入(给预览反馈),不翻页。用全局监听而非 dnd-kit 碰撞:接近区只作视觉提示,
 *     不应影响碰撞/翻页。
 *   - 内层方块(useDroppable):光标进入 → isOver=true → 启动 400ms 充能动画 + 计时器,
 *     充满翻一页(保留 spec 的 ~400ms 停留以防误触)。
 *
 * 单次进入只翻一页(惰性):翻过后 flippedRef 置位,持续停留不连翻;光标离开方块复位,
 * 重新进入才翻下一页。
 *
 * 纯触发(非落点):方块是翻页 affordance,其上松手由 DashboardPage.handleDragOver/End
 * 按 over=edge 放行/no-op(图标回原位);跨页落子仍靠翻过去后挪进目标页网格。
 *
 * 仅拖拽中挂载;已到首/末页该侧无可翻目标时不挂载。
 */
function EdgeDropZone({ side }: { side: 'left' | 'right' }) {
  const { active: activeIndex, count, goTo } = useCarousel()
  const { active } = useDndContext()
  const { isOver, setNodeRef } = useDroppable({
    id: side === 'left' ? EDGE_DROP_ID.left : EDGE_DROP_ID.right,
  })

  // 接近检测:拖拽中监听全局 pointermove,按光标到屏幕边的距离算 proximity(0..1)驱动淡入。
  const [proximity, setProximity] = useState(0)
  useEffect(() => {
    if (!active) return
    const onMove = (e: PointerEvent) => {
      const dist = side === 'left' ? e.clientX : window.innerWidth - e.clientX
      setProximity(dist < APPROACH_PX ? 1 - dist / APPROACH_PX : 0)
    }
    window.addEventListener('pointermove', onMove)
    return () => window.removeEventListener('pointermove', onMove)
  }, [active, side])

  // 单次进入只翻一页(惰性)+ 400ms 充能。
  const flippedRef = useRef(false)
  useEffect(() => {
    if (!isOver) {
      flippedRef.current = false // 离开方块 → 复位,允许下次进入再翻
      return
    }
    if (flippedRef.current) return // 本次进入已翻过,等离开后再来
    const dir = side === 'left' ? -1 : 1
    const target = activeIndex + dir
    if (target < 0 || target > count - 1) return // 已到边界,不翻
    const timer = window.setTimeout(() => {
      flippedRef.current = true
      goTo(target)
    }, DWELL_MS)
    return () => window.clearTimeout(timer)
  }, [isOver, side, activeIndex, count, goTo])

  // 无拖拽 / 已到该侧边界(无可翻目标)→ 不挂载
  if (!active) return null
  if (side === 'left' ? activeIndex <= 0 : activeIndex >= count - 1) return null

  // 可见度:接近淡入(proximity)+ 进入方块时强制全显(isOver)
  const visible = Math.max(proximity, isOver ? 1 : 0)
  return (
    <div
      ref={setNodeRef}
      aria-hidden
      className={
        'absolute top-1/2 -translate-y-1/2 z-20 w-16 h-24 rounded-3xl glass-panel ' +
        'flex items-center justify-center overflow-hidden pointer-events-none ' +
        (side === 'left' ? 'left-3' : 'right-3')
      }
      style={{ opacity: visible, transition: 'opacity 120ms ease-out' }}
    >
      {/* 充能进度条:isOver 时 0→100% 高度,正好与 400ms 计时器同步,给出「正在充能」视觉 */}
      <span
        className="absolute inset-x-0 bottom-0 bg-accent/30"
        style={{ height: isOver ? '100%' : '0%', transition: 'height 400ms linear' }}
      />
      <span className="relative text-white/80 text-2xl leading-none">
        {side === 'left' ? '‹' : '›'}
      </span>
    </div>
  )
}
