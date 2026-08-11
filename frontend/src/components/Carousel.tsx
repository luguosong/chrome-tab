import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useDndContext, useDroppable } from '@dnd-kit/core'
import PageTabs from './PageTabs'

/**
 * 走马灯：基于 CSS scroll-snap，原生顺滑、自带触控/触控板支持。
 * - 横向滚动 + snap-x mandatory，每页宽度 = 容器宽度
 * - 左右玻璃箭头、常驻 PageTabs 页签条(切换/重排/管理,见 PageTabs)
 * - 滚轮纵向 → 翻页(阻止页面内滚动,见 CONTEXT.md「页面」:固定画布)
 * - 键盘 ←/→ 翻页
 * - scroll 事件同步激活页
 * - 尊重 prefers-reduced-motion（关闭 smooth）
 */

/**
 * 边缘翻页 droppable 的 id(07)。EdgeDropZone 在此定义,DashboardPage 的 onDragOver
 * 据此识别"落在边缘"并放行(边缘翻页由 EdgeDropZone 自管计时器,不走跨页移动逻辑)。
 * 集中常量避免两处字面量漂移。
 */
export const EDGE_DROP_ID = {
  left: 'edge-left',
  right: 'edge-right',
} as const

interface CarouselApi {
  /** 当前激活页索引(供 PageTabs 高亮等读取) */
  active: number
  /** 总页数(issue 07:边缘自动翻页需要判断是否到边界) */
  count: number
  /** 翻到第 i 页(自动夹到 [0, count-1]) */
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
  const reduceMotion = useRef(
    typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  ).current

  const goTo = useCallback(
    (i: number) => {
      const el = ref.current
      if (!el) return
      const clamped = Math.max(0, Math.min(labels.length - 1, i))
      el.scrollTo({
        left: clamped * el.clientWidth,
        behavior: reduceMotion ? 'auto' : 'smooth',
      })
    },
    [labels.length, reduceMotion],
  )

  // 页数变化时(删页/重排后)夹住 active,防止索引越界指向已不存在的页。
  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, labels.length - 1)))
  }, [labels.length])

  // scroll → 激活页同步
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let raf = 0
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const i = Math.round(el.scrollLeft / el.clientWidth)
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
  }, [active, onActiveChange])

  // 滚轮翻页(CONTEXT.md「页面」:滚轮用于页间切换,而非页内滚动)。
  // 只接管"纵向滚轮"(常规鼠标):deltaY 占主导时翻页并 preventDefault;
  // 横向(触控板横扫 |deltaX|≥|deltaY|)交给原生 snap。400ms 节流防一次手势连翻多页。
  // 与 06/07 图标拖拽的 PointerSensor 不冲突:wheel 与 pointer 是不同事件流。
  const lastWheel = useRef(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return // 横向交给原生
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

  const arrowCls =
    'absolute top-1/2 -translate-y-1/2 z-20 w-11 h-11 rounded-full ' +
    'glass-panel flex items-center justify-center text-white/90 hover:bg-white/40 ' +
    'dark:text-white/90 dark:hover:bg-white/20 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent'

  return (
    <CarouselApiContext.Provider value={{ active, count: labels.length, goTo }}>
      <div className="relative w-full">
        {/* 翻页区 */}
        <div
          ref={ref}
          className="no-scrollbar flex overflow-x-auto snap-x snap-mandatory scroll-smooth"
          aria-roledescription="carousel"
        >
          {children.map((child, i) => (
            <div
              key={i}
              className="w-full shrink-0 snap-center px-4 sm:px-16"
              aria-roledescription="slide"
              aria-label={labels[i]}
            >
              {child}
            </div>
          ))}
        </div>

        {/* 左箭头 */}
        {active > 0 && (
          <button
            type="button"
            onClick={() => goTo(active - 1)}
            className={`left-1 sm:left-4 ${arrowCls}`}
            aria-label="上一页"
          >
            ‹
          </button>
        )}
        {/* 右箭头 */}
        {active < labels.length - 1 && (
          <button
            type="button"
            onClick={() => goTo(active + 1)}
            className={`right-1 sm:right-4 ${arrowCls}`}
            aria-label="下一页"
          >
            ›
          </button>
        )}

        {/* 常驻页签条:切换/重排/增删改页面(替换原圆点指示器,页签条信息更丰富) */}
        <PageTabs />

        {/* 拖拽到屏幕左右边缘自动翻页(issue 07 / spec user story 31)。
            仅在 DnD 拖拽进行中挂载,避免无拖拽时占据边缘点击区。停留 400ms 翻到相邻页,
            持续停留则每 400ms 连续翻页(走马灯连续跨页体验)。 */}
        <EdgeDropZone side="left" />
        <EdgeDropZone side="right" />
      </div>
    </CarouselApiContext.Provider>
  )
}

/**
 * 拖拽时的左右边缘翻页区(issue 07)。挂在 Carousel 内部(可读 useCarousel)。
 *
 * 工作流(spec user story 31/32):
 *   1. 编辑模式下拖起图标 → DnD `active` 置位 → 本组件挂载并注册为 droppable。
 *   2. 光标拖到左/右边缘 → `isOver=true` → 启动 400ms 计时器。
 *   3. 计时器到点 → `goTo(active ± 1)` 翻到相邻页;翻页后 activeIndex 变化,effect 重跑,
 *      持续停留则每 400ms 再翻一页(连续翻页)。
 *   4. 光标离开边缘 → `isOver=false` → effect 清理函数清掉计时器。
 *
 * 边界已到(第一页左边缘 / 末页右边缘)时不翻(target 越界,直接 return)。
 * 区域 z-10,低于左右箭头(z-20),箭头可点击不受影响;且仅拖拽中挂载,无拖拽时不占边缘。
 */
function EdgeDropZone({ side }: { side: 'left' | 'right' }) {
  const { active: activeIndex, count, goTo } = useCarousel()
  const { active } = useDndContext()
  const { isOver, setNodeRef } = useDroppable({
    id: side === 'left' ? EDGE_DROP_ID.left : EDGE_DROP_ID.right,
  })

  useEffect(() => {
    if (!isOver) return
    const dir = side === 'left' ? -1 : 1
    const target = activeIndex + dir
    if (target < 0 || target > count - 1) return // 已到边界,不翻
    const timer = window.setTimeout(() => goTo(target), 400)
    return () => window.clearTimeout(timer)
  }, [isOver, side, activeIndex, count, goTo])

  // 无拖拽时不渲染(不占边缘点击区)。active 由 DndContext 提供,拖拽中为非空。
  if (!active) return null
  return (
    <div
      ref={setNodeRef}
      aria-hidden
      className={
        'absolute top-0 bottom-0 z-10 w-12 ' + (side === 'left' ? 'left-0' : 'right-0')
      }
    />
  )
}
