import type { ReactNode } from 'react'
import { TILE_ROW_CAP } from '../lib/tileBody'

/**
 * 「块内主体」组件零件(见 CONTEXT.md「块内主体」;BigTile 的 children 侧)。
 * TileBody = 滚动容器单点:容器类逐字同构 ×7 收拢于此,ADR-0021 滚轮契约(原生
 * 滚动、触屏 pan-y、TouchSensor 分流拖拽)随类串落在这一处,新大 tile 不再抄。
 * TileRow / TileRowLink = 行壳的两个真实落点:pill 在 li 本体(点击/hover/静态)
 * 或内层 a(外链)。FreshDot = 24h 红点。行内容(布局/字段/外链语义)永远留域
 * ——同 ADR-0039「表字面量留域」、ADR-0040「内容永远留域」取向。
 */

const SCROLL_CLASS =
  'flex-1 min-h-0 overflow-y-auto flex flex-col px-2 py-1.5 tile-scroll [touch-action:pan-y]'

/** 行壳 pill 两段:底(圆角 + 行距)与 hover 提亮。方言退役(唯一已声明漂移,随迁移记档):原 AiHot 抄写用 `transition`,统一为 `transition-colors`。 */
const PILL_BASE = 'rounded-lg px-2 py-1'
const PILL_HOVER = 'hover:bg-white/10 transition-colors'

export function TileBody({
  as = 'ol',
  cap = TILE_ROW_CAP,
  onScroll,
  rows,
}: {
  /** 列表元素:ol 为默认(有序榜六家);div 供分组编组家(AI 热点)。 */
  as?: 'ol' | 'div'
  /** 行数渲染窗:最近 N 行;null = 全量翻阅(AI 热点/待办显式声明)。 */
  cap?: number | null
  /** 滚动钩子(待办:滚动即收快览)。 */
  onScroll?: () => void
  /** 行 JSX 数组(域内 map 好的行);行数窗在此施加,域只管内容。 */
  rows: ReactNode[]
}) {
  const Tag = as
  return (
    <Tag className={SCROLL_CLASS} onScroll={onScroll}>
      {cap === null ? rows : rows.slice(0, cap)}
    </Tag>
  )
}

/** 行可点性:{ onClick } 点行有动作(待办开详情)| 'hover' 仅供高亮(模型/AI 热点)| false 纯静态(更新日志——不可点不做 hover,免暗示交互)。 */
export type TileRowInteractive = { onClick: () => void } | 'hover' | false

export function TileRow({
  interactive = false,
  title,
  onMouseEnter,
  onMouseLeave,
  className,
  children,
}: {
  interactive?: TileRowInteractive
  /** 悬浮全文(li 级;文本级截断救济归域内 span 的 title)。 */
  title?: string
  /** 待办快览的 hover 意图接线(hover 卡挂在 li 上);其余域不传。 */
  onMouseEnter?: (e: React.MouseEvent<HTMLLIElement>) => void
  onMouseLeave?: (e: React.MouseEvent<HTMLLIElement>) => void
  /** 域内布局类(flex/gap/min-w-0 等);pill 底已含 px/py/圆角/hover。 */
  className?: string
  children: ReactNode
}) {
  const pill =
    PILL_BASE +
    (interactive ? ' ' + PILL_HOVER : '') +
    (interactive && interactive !== 'hover' ? ' cursor-pointer' : '')
  return (
    <li
      title={title}
      onClick={interactive && interactive !== 'hover' ? interactive.onClick : undefined}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={pill + (className ? ' ' + className : '')}
    >
      {children}
    </li>
  )
}

export function TileRowLink({
  href,
  title,
  className,
  children,
}: {
  href: string
  /** 悬浮全文(外链行的新 tab 提示/原文核对,归域传值)。 */
  title?: string
  /** a 上的布局类;省缺 block(视频/新闻的行内块)。 */
  className?: string
  children: ReactNode
}) {
  return (
    <li className="min-w-0">
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        title={title}
        className={PILL_BASE + ' ' + PILL_HOVER + ' ' + (className ?? 'block')}
      >
        {children}
      </a>
    </li>
  )
}

/** 24h 红点(baseline 行用 self-center;items-center 行里是 no-op)。判据由调用方传入:常规行用 lib isFreshRow,模型行动态鲜度用 isFreshModelEvent(域规则)。 */
export function FreshDot({ show }: { show: boolean }) {
  if (!show) return null
  return <span className="h-1.5 w-1.5 shrink-0 self-center rounded-full bg-red-400" aria-hidden="true" />
}
