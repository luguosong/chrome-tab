import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
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

interface CarouselApi {
  /** 当前激活页索引(供 PageTabs 高亮等读取) */
  active: number
  /** 翻到第 i 页(自动夹到 [0, count-1]) */
  goTo: (i: number) => void
}

const CarouselApiContext = createContext<CarouselApi>({
  active: 0,
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
    <CarouselApiContext.Provider value={{ active, goTo }}>
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
      </div>
    </CarouselApiContext.Provider>
  )
}
