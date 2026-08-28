import { newsSourceLabel } from 'chrome-tab-shared'
import { useNewsFeed } from '../hooks/useNews'
import { ICON_SCALE, tileFont } from '../lib/iconLayout'
import { timeAgo } from '../lib/timeAgo'
import { isFreshRow } from '../lib/tileBody'
import type { Icon } from '../lib/types'
import BigTile from './BigTile'
import { FreshDot, TileBody, TileRowLink } from './TileBody'

/**
 * 新闻图标的专属网格渲染(见 CONTEXT.md「新闻」;3×2 大 tile,ADR-0021/0022 范式):
 * 外壳/标头走 BigTile(标头鲜度 = 勾选源的最近成功抓取时间最大值,spec 口径),主体 =
 * **全源混合**的单列滚动新闻流(块内主体骨架走 TileBody,见 CONTEXT.md「块内主体」;
 * 行 = 源名·相对时间(可缺)+ 24h 红点(仅限时条目)+ 标题截断,点行外跳原文 =
 * TileRowLink 外链臂)。空态两级:零勾选引导开「管理」;勾选后首取未完提示抓取中。
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
  const fontSize = tileFont(ICON_SCALE, 'secondary')
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
        <TileBody
          rows={items.map((n) => (
            <TileRowLink key={n.id} href={n.url} title={n.title}>
              <span className="flex min-w-0 items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-white/45" style={{ fontSize }}>
                  {newsSourceLabel(n.source)}
                  {n.publishedAt !== null && ` · ${timeAgo(new Date(n.publishedAt * 1000).toISOString())}`}
                </span>
              </span>
              <span className="flex min-w-0 items-center gap-1.5">
                <FreshDot show={isFreshRow(n.publishedAt)} />
                {/* 译文主行,悬停 title 属性恒英文原文供核对(ADR-0029) */}
                <span className="min-w-0 truncate text-white/90" style={{ fontSize }}>
                  {n.titleZh ?? n.title}
                </span>
              </span>
            </TileRowLink>
          ))}
        />
      )}
    </BigTile>
  )
}
