import { newsSourceLabel } from 'chrome-tab-shared'
import { useNewsFeed } from '../hooks/useNews'
import { tileFont } from '../lib/iconLayout'
import { timeAgo } from '../lib/timeAgo'
import { useLayoutSettings } from '../context/LayoutSettingsContext'
import type { Icon } from '../lib/types'
import BigTile from './BigTile'

/** 榜单最多渲染行数(对齐 ADR-0022 changelog/video 30 行先例,看更早走 Modal)。 */
const MAX_ROWS = 30
/** 新条目红点窗口:发布 <24h,仅限有发布时间的条目(时间驱动满窗自隐,无已读概念)。 */
const NEW_WINDOW_S = 24 * 60 * 60

/**
 * 新闻图标的专属网格渲染(见 CONTEXT.md「新闻」;3×2 大 tile,ADR-0021/0022 范式):
 * 外壳/标头走 BigTile(标头鲜度 = 勾选源的最近成功抓取时间最大值,spec 口径),主体 =
 * **全源混合**的单列滚动新闻流(行 = 源名·相对时间(可缺)+ 24h 红点(仅限时条目)+
 * 标题截断,点行外跳原文)。空态两级:零勾选引导开「管理」;勾选后首取未完提示抓取中。
 * 数据自持 useNewsFeed(后端 30min 轮询预取、前端只读库,ADR-0027)。
 */
export default function NewsIconBody({
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
  const { data, isError } = useNewsFeed()
  const { iconScale } = useLayoutSettings()
  const fontSize = tileFont(iconScale, 'secondary')
  const items = data?.items ?? []
  const sources = data?.sources ?? []
  const fresh =
    sources.length === 0
      ? null
      : sources.reduce<string | null>(
          (acc, s) => (!s.lastSuccessAt || (acc && s.lastSuccessAt <= acc) ? acc : s.lastSuccessAt),
          null,
        )

  return (
    <BigTile
      title="新闻"
      fresh={fresh}
      onOpenDetail={onOpenDetail}
      moreTitle="查看全部新闻与源管理"
      overlay={overlay}
    >
      {isError ? (
        // 取数失败 ≠ 零勾选(code-review):恒在场 tile 误导用户去重选,显式降级为失败文案
        <div className="flex-1 flex items-center justify-center text-white/40" style={{ fontSize }}>
          新闻流刷新失败
        </div>
      ) : sources.length === 0 ? (
        // 空态引导(spec):零勾选时指路 Modal「管理」tab,而非空白省略号
        <div className="flex-1 flex items-center justify-center text-white/40" style={{ fontSize }}>
          还没有勾选新闻源——打开「更多」挑选来源
        </div>
      ) : items.length === 0 ? (
        // 勾选了但暂无条目:首取在后台尾链进行(30min 轮询兜底)
        <div className="flex-1 flex items-center justify-center text-white/40" style={{ fontSize }}>
          正在抓取勾选源…
        </div>
      ) : (
        <ol
          // 原生滚动翻阅(tile-scroll;触屏 pan-y,TouchSensor 分流拖拽;同 aihot/todo/video)
          className="flex-1 min-h-0 overflow-y-auto flex flex-col px-2 py-1.5 tile-scroll [touch-action:pan-y]"
        >
          {items.slice(0, MAX_ROWS).map((n) => {
            const isNew = n.publishedAt !== null && Date.now() / 1000 - n.publishedAt < NEW_WINDOW_S
            return (
              <li key={n.id} className="min-w-0">
                <a
                  href={n.url}
                  target="_blank"
                  rel="noreferrer"
                  title={n.title}
                  className="block rounded-lg px-2 py-1 hover:bg-white/10 transition-colors"
                >
                  <span className="flex min-w-0 items-baseline justify-between gap-2">
                    <span className="min-w-0 truncate text-white/45" style={{ fontSize }}>
                      {newsSourceLabel(n.source)}
                      {n.publishedAt !== null && ` · ${timeAgo(new Date(n.publishedAt * 1000).toISOString())}`}
                    </span>
                  </span>
                  <span className="flex min-w-0 items-center gap-1.5">
                    {isNew && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-400" aria-hidden="true" />}
                    <span className="min-w-0 truncate text-white/90" style={{ fontSize }}>
                      {n.title}
                    </span>
                  </span>
                </a>
              </li>
            )
          })}
        </ol>
      )}
    </BigTile>
  )
}
