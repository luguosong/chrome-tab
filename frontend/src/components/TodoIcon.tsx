import { useTodo } from '../hooks/useTodo'
import { tileFont } from '../lib/iconLayout'
import { useLayoutSettings } from '../context/LayoutSettingsContext'
import type { Icon } from '../lib/types'
import BigTile from './BigTile'

/**
 * 待办图标的专属网格渲染(见 CONTEXT.md「待办」;3×2 大 tile,同「AI 热点」
 * ADR-0021/0022 范式):外壳/标头走 BigTile,主体 = **收集箱**滚动列表(一行一条
 * 标题单行截断——收集箱任务名短,单行换得更多条目;行首中性小圆点呼应 Modal 的
 * 完成语汇,不承载优先级)。空收集箱居中提示。三视图切换/勾选/速记全归 Modal
 * (标头「更多」唯一入口);标题即外链,直达滴答网页版收集箱。数据自持 useTodo。
 */
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
  const { iconScale } = useLayoutSettings()
  const fontSize = tileFont(iconScale, 'secondary')
  const inbox = data?.inbox ?? []

  return (
    <BigTile
      title="待办"
      titleHref="https://dida365.com/webapp/#p/inbox/tasks"
      titleLinkHint="打开滴答清单收集箱"
      fresh={null}
      onOpenDetail={onOpenDetail}
      moreTitle="查看全部待办"
      overlay={overlay}
    >
      {data === undefined || data === null ? null : inbox.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-white/40" style={{ fontSize }}>
          收集箱是空的
        </div>
      ) : (
        <ol
          // 原生滚动翻阅全量(雾胶囊滚动条 tile-scroll,触屏 pan-y 保原生滚动,TouchSensor 分流拖拽;同 aihot)
          className="flex-1 min-h-0 overflow-y-auto flex flex-col px-2 py-1.5 tile-scroll [touch-action:pan-y]"
        >
          {inbox.map((t) => (
            <li key={t.id} className="flex items-center gap-2 min-w-0 px-2 py-1 rounded-lg">
              <span aria-hidden className="shrink-0 w-1 h-1 rounded-full bg-white/25" />
              <span className="min-w-0 truncate text-white/90" title={t.title} style={{ fontSize }}>
                {t.title}
              </span>
            </li>
          ))}
        </ol>
      )}
    </BigTile>
  )
}
