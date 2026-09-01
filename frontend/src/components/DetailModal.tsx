import { type ReactNode, useEffect } from 'react'
import ModalShell from './ModalShell'
import { type PaneState, type TabItem, normalizeTab } from '../lib/detailModalState'

/**
 * 详情 Modal 骨架(CONTEXT.md「详情 Modal 骨架」,ADR-0040):ModalShell
 * (ADR-0031,几何/Esc 栈/动画)之上的公共结构层——标头(名称 + 可选刷新钮)、
 * tab 条(含悬空回落)、主体查询状态机、打开即对账。各域只声明 tab 派生、
 * 空态/失败文案与内容;内容主体(管理 pane、图表、列表)永远留域。
 *
 * 双出口:DetailModal(复合,九家消费——批 1:新闻/视频更新/服务器状态,批 2:
 * 待办/模型追踪/股票/天气/更新日志/趋势)+ QueryPane(状态机零件,per-tab 各持
 * 查询态的域——「AI 热点」三 tab——与域内自持三态的分段域用,DetailModal 内部
 * 亦消费它)。
 */

/** 重试钮方言(min-h-8 触达裁决,ADR-0040 漂移①)单点——QueryPane 与域内自持的
 *  错误行(如新闻管理 tab 的勾选集加载失败)共用,改方言只改这里。 */
export const retryButtonClass =
  'rounded-full border border-white/30 px-3 py-1.5 min-h-8 text-xs text-white/80 hover:border-accent hover:text-accent active:bg-white/20 transition-colors focus-visible:outline-2 focus-visible:outline-white/60 disabled:opacity-50'

/** 状态机零件:四态归约结果的渲染映射(决策在 lib/detailModalState)。 */
export function QueryPane({
  state,
  onRetry,
  retryBusy,
  children,
}: {
  state: PaneState
  /** error 态重试钮回调(点击重拉);省缺不渲染钮(不产死钮)。 */
  onRetry?: () => void
  /** 重试进行中禁用连点(通常与标头刷新钮共用 isFetching)。 */
  retryBusy?: boolean
  /** content 态内容;省缺 = 当单态渲染器用(只渲染 error/loading/empty 块)。 */
  children?: ReactNode
}) {
  if (state.kind === 'loading')
    return (
      <div className="text-sm text-white/50 py-6 text-center">{state.message ?? '加载中…'}</div>
    )
  if (state.kind === 'error')
    return (
      <div className="flex items-center gap-3 py-4">
        <span className="text-sm text-white/60">{state.message}</span>
        {onRetry && (
          <button type="button" onClick={onRetry} disabled={retryBusy} className={retryButtonClass}>
            重试
          </button>
        )}
      </div>
    )
  if (state.kind === 'empty')
    return <div className="text-sm text-white/50 py-6 text-center">{state.message}</div>
  return <>{children}</>
}

interface DetailModalBaseProps<T extends string> {
  onClose: () => void
  ariaLabel: string
  /** 标题;省缺不渲染标头行(如「服务器状态」现状无标头)。 */
  title?: string
  /** 标题下的说明行(静态副行/鲜度位等;7/9 家共性形态,批 2 起)——ReactNode,
   *  域要 mono/动态文本(股票代码、趋势「抓取于 X」)自持样式与内容。 */
  subtitle?: ReactNode
  /** 声明即渲染标头刷新钮(声明式:域对鲜度有诉求才有,ADR-0040)。 */
  refresh?: () => void
  /** 刷新/重试进行中(转圈 + 禁用连点;两钮通常同一 isFetching)。 */
  busy?: boolean
  /** 受控选中 tab;悬空回落由骨架归一(渲染与内容派生共享 normalizeTab)。 */
  tab?: T
  /** 查询主体状态机;null/省缺 = 主体自持(管理 tab 或 per-tab 查询态域)。 */
  pane?: PaneState | null
  /** pane 处于 error 态时的重试回调;省缺回落 refresh(通常同一 refetch)。 */
  onRetry?: () => void
  /** 打开即对账:挂载时回调一次(声明式,仅对鲜度有诉求的域)。 */
  onOpen?: () => void
  /** 以下四项透传 ModalShell(见 ADR-0031)。 */
  width?: 'sm' | 'lg' | '2xl' | '3xl'
  scroll?: boolean
  z?: number
  className?: string
  children: ReactNode
}

/** 声明 tabs 即必须声明 onTabChange:tab 条是受控件,漏声明 = 点按静默无反应的
 *  死 tab 条(编译期拦下,不留运行期暗坑)。 */
export type DetailModalProps<T extends string> = DetailModalBaseProps<T> &
  (
    | { tabs?: undefined; onTabChange?: undefined }
    | { tabs: readonly TabItem<T>[]; onTabChange: (tab: T) => void }
  )

export default function DetailModal<T extends string>({
  onClose,
  ariaLabel,
  title,
  subtitle,
  refresh,
  busy,
  tabs,
  tab,
  onTabChange,
  pane,
  onRetry,
  onOpen,
  width,
  scroll,
  z,
  className,
  children,
}: DetailModalProps<T>) {
  // 打开即对账:refetch 引用稳定(React Query),空依赖安全——此约定单点于此
  useEffect(() => {
    onOpen?.()
  }, [])

  // 空列 = 无 tab 形态(与省缺同):tab 列表派生自查询的域挂载初帧常为 [],在此
  // 单点吸收,域不必自守 length(且空列下 tabs[0].key 会炸,lib 侧防御盖不到组件侧)
  const active = tabs?.length ? normalizeTab(tabs, tab ?? tabs[0].key) : undefined

  return (
    <ModalShell onClose={onClose} ariaLabel={ariaLabel} width={width} scroll={scroll} z={z} className={className}>
      {(title !== undefined || refresh !== undefined || subtitle !== undefined) && (
        <div className="mb-3">
          <div className="flex items-center gap-2">
            {title !== undefined && <h2 className="text-lg font-semibold text-white/90">{title}</h2>}
            {refresh !== undefined && (
              <button
                type="button"
                onClick={refresh}
                disabled={busy}
                aria-label="刷新"
                title="刷新"
                className="w-6 h-6 rounded-full bg-white/20 text-white/80 hover:bg-white/40 focus-visible:outline-2 focus-visible:outline-white/60 flex items-center justify-center text-sm disabled:opacity-50"
              >
                <span
                  className={busy ? 'animate-spin inline-block motion-reduce:animate-none' : 'inline-block'}
                >
                  ↻
                </span>
              </button>
            )}
          </div>
          {subtitle !== undefined && <div className="text-xs text-white/50">{subtitle}</div>}
        </div>
      )}

      {tabs != null && tabs.length > 0 && (
        /* tab 按钮不可加 -mb-px 压线:overflow-x-auto 会把 overflow-y 计算为 auto,1px 溢出即冒垂直滚动条。
           横条走 modal-scroll 雾胶囊(与面板同语汇,占位 8px 随行盒长高、下划线与分隔线同盒不脱开)——
           tab 多时常态溢出,横滚是主交互,藏条会失去拖拽与可滚提示 */
        <div
          role="tablist"
          aria-label={`${ariaLabel}视图`}
          className="flex gap-4 border-b border-white/10 mb-3 overflow-x-auto modal-scroll"
        >
          {tabs.map(({ key, label }) => (
            <button
              key={key}
              role="tab"
              aria-selected={active === key}
              type="button"
              onClick={() => onTabChange?.(key)}
              className={
                'pb-1.5 text-sm border-b-2 whitespace-nowrap transition focus-visible:outline-2 focus-visible:outline-white/60 ' +
                (active === key
                  ? 'text-accent border-accent'
                  : 'text-white/60 border-transparent hover:text-white/85')
              }
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* 主体态切换(tab 换视图 / loading→content / 重试回路)pane-in 淡入:key 变化
          重挂触发。只包 pane 态分支——pane=null 域的主体布局由域自持(待办分栏的
          flex 链等),外包层会断 flex 协议,维持现状。玻璃底在 ModalShell,此处
          opacity 合法 */}
      {pane != null ? (
        <div key={`${String(active)}:${pane.kind}`} className="animate-pane-in">
          <QueryPane state={pane} onRetry={onRetry ?? refresh} retryBusy={busy}>
            {children}
          </QueryPane>
        </div>
      ) : (
        children
      )}
    </ModalShell>
  )
}
