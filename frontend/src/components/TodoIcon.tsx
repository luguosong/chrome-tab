import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTodo } from '../hooks/useTodo'
import { useHoverGrace } from '../hooks/useHoverGrace'
import { ICON_SCALE, tileFont } from '../lib/iconLayout'
import type { Icon } from '../lib/types'
import type { TodoTask } from '../lib/todo'
import BigTile from './BigTile'
import { TileBody, TileRow } from './TileBody'
import { TodoDetailModal, TodoDetailPanel } from './TodoDetail'
import { useCarousel } from './Carousel'

/**
 * 待办图标的专属网格渲染(见 CONTEXT.md「待办」;3×2 大 tile,同「AI 热点」
 * ADR-0021/0022 范式):外壳/标头走 BigTile,主体 = **收集箱**滚动列表(一行一条
 * 标题单行截断——收集箱任务名短,单行换得更多条目;行首中性小圆点呼应 Modal 的
 * 完成语汇,不承载优先级)。悬浮行即在行右侧快览「待办详情」(hover 卡,详情
 * 面板第三形态);点行弹「待办详情」二级对话框深读(编辑模式不悬浮不弹);
 * 空收集箱居中提示。三视图切换/勾选/速记全归 Modal(标头「更多」唯一入口);
 * 标题即外链,直达滴答网页版收集箱。数据自持 useTodo。
 */

/** 快览卡几何常量:宽 320、与行距 8、视口留边 12、贴底时保的最小可用高。 */
const PEEK_W = 320
const PEEK_GAP = 8
const PEEK_MARGIN = 12
const PEEK_MIN_H = 240
/** 首次交互门槛:挂载后指针累计位移不足此值(px)不弹快览——刷新/开新标签页后
 *  行常渲染到静置指针正下方,微动 1px 触发 mouseenter 即幽灵弹卡;真实移过去则远超。 */
const PEEK_MOVE_GATE = 10

/** 快览状态:任务 + 定位 + 行盒快照(收起宽限期的几何联合判定用)。 */
type Peek = { task: TodoTask; rowRect: DOMRect; left: number; top: number; maxH: number }

/** 快览卡定位(纯函数):行右侧、顶对齐行;右缘放不下翻到行左;行贴底下空间
 *  不足(240)则改为贴视口底上移——任何行位都不出视口。 */
function peekPos(r: DOMRect) {
  const vw = window.innerWidth
  const vh = window.innerHeight
  let left = r.right + PEEK_GAP
  if (left + PEEK_W > vw - PEEK_MARGIN) left = Math.max(PEEK_MARGIN, r.left - PEEK_GAP - PEEK_W)
  let top = r.top
  let maxH = vh - top - PEEK_MARGIN
  if (maxH < PEEK_MIN_H) {
    maxH = Math.min(PEEK_MIN_H, vh - 2 * PEEK_MARGIN)
    top = vh - maxH - PEEK_MARGIN
  }
  return { left, top, maxH }
}

export default function TodoIconBody({
  icon,
  overlay = false,
  onOpenDetail,
}: {
  icon: Icon
  overlay?: boolean
  /** 「更多」按钮直调(ADR-0022);undefined = 编辑模式/overlay,按钮不渲染。 */
  onOpenDetail?: () => void
}) {
  void icon // 单例无实例参数(data 无字段);保留形参对齐其它 body 的接口
  const { data } = useTodo()
  const fontSize = tileFont(ICON_SCALE, 'secondary')
  const inbox = data?.inbox ?? []
  const [detail, setDetail] = useState<TodoTask | null>(null)

  // 快览显隐走「悬浮宽限」手势(CONTEXT.md;lib/hoverGrace 状态机,同 Clock
  // 范式)——行与卡之间的视觉间隙在 DOM 上不属于任何元素,慢速穿越时 :hover
  // 断链即收、卡内链接不可达;250ms 宽限 + 「行盒∪卡盒」外接矩形续期判定与
  // 首次交互门槛(防刷新后静置指针幽灵弹卡)都在状态机单点。Peek 即会话快照
  // (任务 + 行盒 + 定位几何),随 hovering 一体持有。卡 fixed 挂 BigTile 外
  // (玻璃 backdrop-filter 会钳 fixed 后代,行内 absolute 又会被列表 overflow 裁切)。
  const { hovering: peek, floatingRef, enter, leave, stay, close } = useHoverGrace<Peek>(PEEK_MOVE_GATE)
  // 轮询刷新会重建行 DOM(元素卸载不触发 mouseleave),快览可能挂死——数据变即收
  useEffect(() => {
    close()
  }, [data, close])
  // 切页即收快览:卡 fixed 于视口,而键盘等非鼠标驱动的切页不触发浏览器 hover 链
  // 重算,行滚出视口后 mouseleave 永不到来,卡就残留在已翻走的页上
  const { active } = useCarousel()
  useEffect(() => {
    close()
  }, [active, close])

  return (
    // 二级详情与快览卡都挂 BigTile 外:glass-soft 的 backdrop-filter 会成为 fixed
    // 后代的包含块,挂 children 里会把全屏遮罩钳进 tile 盒(overflow-hidden 再裁掉)
    <>
      <BigTile
        title="待办"
        titleHref="https://dida365.com/webapp/#p/inbox/tasks"
        titleLinkHint="打开滴答清单收集箱"
        fresh={null}
        onOpenDetail={onOpenDetail}
        moreTitle="查看全部待办"
        overlay={overlay}
      >
        {!data ? null : inbox.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-white/40" style={{ fontSize }}>
            收集箱是空的
          </div>
        ) : (
          <TileBody
            cap={null}
            // 全量翻阅(cap={null} 显式声明):速记即入箱即见,30 行窗不适用
            // 滚动即收快览:行移位后 fixed 卡的定位快照过期,收起最干净
            onScroll={close}
            rows={inbox.map((t) => (
              // 悬浮行右侧快览详情(hover 卡),点行开二级对话框深读;
              // 编辑模式(overlay)是布局编辑语义,不悬浮不弹(= TileRow 静态臂)
              <TileRow
                key={t.id}
                interactive={overlay ? false : { onClick: () => {
                  close()
                  setDetail(t)
                } }}
                onMouseEnter={overlay ? undefined : (e) => {
                  // 门槛判定在状态机:mouseenter 早于 mousemove 派发,读到的是「到达行
                  // 之前」的累计位移——真实移来早已过门槛,静置微动恰好被拦(见 lib)
                  const r = e.currentTarget.getBoundingClientRect()
                  enter({ task: t, rowRect: r, ...peekPos(r) })
                }}
                onMouseLeave={overlay ? undefined : (e) => leave(e.currentTarget.getBoundingClientRect())}
                className="flex items-center gap-2 min-w-0"
              >
                <span aria-hidden className="shrink-0 w-1 h-1 rounded-full bg-white/25" />
                {/* 单行截断的救济:快览卡外的兜底 hover 全文(报告 #14) */}
                <span className="min-w-0 truncate text-white/90" style={{ fontSize }} title={t.title}>
                  {t.title}
                </span>
              </TileRow>
            ))}
          />
        )}
      </BigTile>
      {/* 快览卡:详情面板第三形态(同 TodoDetailPanel),非模态、Esc/焦点不接管;
          键盘与触屏走点行弹二级对话框的等价路径。createPortal 出网格项——
          Tile 的 hover:scale-110 是 transform 祖先,会钳 fixed 后代的定位
          (快览要求指针停在行上,scale 恒在,不像二级对话框有遮罩接管后自愈) */}
      {peek &&
        !detail &&
        createPortal(
          <div
            ref={floatingRef}
            onMouseEnter={stay}
            onMouseLeave={() => peek && leave(peek.rowRect)}
            style={{ left: peek.left, top: peek.top, maxHeight: peek.maxH, width: PEEK_W }}
            className="fixed z-[60] glass-panel glass-panel-readable rounded-2xl p-4 flex flex-col animate-fade-in"
          >
            <TodoDetailPanel task={peek.task} />
          </div>,
          document.body,
        )}
      {detail && <TodoDetailModal task={detail} onClose={() => setDetail(null)} />}
    </>
  )
}
