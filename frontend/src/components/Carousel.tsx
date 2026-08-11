import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'

/**
 * 走马灯：基于 CSS scroll-snap，原生顺滑、自带触控/触控板/滚轮支持。
 * - 横向滚动 + snap-x mandatory，每页宽度 = 容器宽度
 * - 左右玻璃箭头、底部圆点指示器
 * - 键盘 ←/→ 翻页
 * - scroll 事件同步激活页
 * - 尊重 prefers-reduced-motion（关闭 smooth）
 */

const CarouselApiContext = createContext<{ goTo: (i: number) => void }>({
  goTo: () => {},
})

/** 子页面用：从内部控制翻页 */
export function useCarousel() {
  return useContext(CarouselApiContext)
}

interface CarouselProps {
  /** 各页标题，用于 aria-label 与圆点 */
  labels: string[]
  children: ReactNode[]
}

export default function Carousel({ labels, children }: CarouselProps) {
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

  // scroll → 激活页同步
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let raf = 0
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const i = Math.round(el.scrollLeft / el.clientWidth)
        if (i !== active) setActive(i)
      })
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(raf)
    }
  }, [active])

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
    <CarouselApiContext.Provider value={{ goTo }}>
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

        {/* 圆点指示器 */}
        <div className="mt-5 flex justify-center gap-2">
          {labels.map((label, i) => (
            <button
              key={i}
              type="button"
              onClick={() => goTo(i)}
              aria-label={`第 ${i + 1} 页：${label}`}
              aria-current={active === i}
              className={
                'h-2 rounded-full transition-all ' +
                (active === i
                  ? 'w-7 bg-accent'
                  : 'w-2 bg-white/50 hover:bg-white/80')
              }
            />
          ))}
        </div>
      </div>
    </CarouselApiContext.Provider>
  )
}
