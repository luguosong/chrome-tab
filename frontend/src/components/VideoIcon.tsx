import { useVideoFeed } from '../hooks/useVideoUpdates'
import { ICON_SCALE, tileFont } from '../lib/iconLayout'
import { timeAgo } from '../lib/timeAgo'
import { isFreshRow } from '../lib/tileBody'
import type { Icon } from '../lib/types'
import BigTile from './BigTile'
import { FreshDot, TileBody, TileRowLink } from './TileBody'

/**
 * 视频更新图标的专属网格渲染(见 CONTEXT.md「视频更新」;3×2 大 tile,ADR-0021/0022
 * 范式):外壳/标头走 BigTile(标头鲜度 = 最新视频发布时间),主体 = **全分类混合**的
 * 单列滚动视频流(块内主体骨架走 TileBody,见 CONTEXT.md「块内主体」;一行一条:
 * 博主名·相对时间 + 标题截断 + 平台小标记,发布 24h 内行首红点),点行外跳原平台
 * (新标签,TileRowLink 外链臂)。**缩略图不上 tile**(spec 口径)。分类是 Modal 的
 * tab 维度,不是画布维度。空流(无博主/无视频)指路引导,入口在「更多」Modal。
 * 数据自持 useVideoFeed(后端 1h 轮询预取、前端只读库,ADR-0023)。
 */
export default function VideoIconBody({
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
  const { data } = useVideoFeed()
  const fontSize = tileFont(ICON_SCALE, 'secondary')
  const videos = data ?? []
  const fresh = videos[0] ? new Date(videos[0].publishedAt * 1000).toISOString() : null

  return (
    <BigTile
      title="视频更新"
      fresh={fresh}
      onOpenDetail={onOpenDetail}
      moreTitle="查看全部视频与博主管理"
      overlay={overlay}
    >
      {videos.length === 0 ? (
        // 空态引导(spec):无博主(或首取未完)时指路「管理」tab,而非空白省略号
        <div className="flex-1 flex items-center justify-center text-white/40" style={{ fontSize }}>
          还没有视频——打开「更多」添加博主
        </div>
      ) : (
        <TileBody
          rows={videos.map((v) => (
            <TileRowLink key={v.id} href={v.url} title={v.title}>
              <span className="flex items-baseline justify-between gap-2 min-w-0">
                <span className="min-w-0 truncate text-white/45" style={{ fontSize }}>
                  {v.bloggerName} · {timeAgo(new Date(v.publishedAt * 1000).toISOString())}
                </span>
                <span className="shrink-0 font-mono text-white/35" style={{ fontSize }}>
                  {v.platform === 'youtube' ? 'YT' : 'B站'}
                </span>
              </span>
              <span className="flex min-w-0 items-center gap-1.5">
                <FreshDot show={isFreshRow(v.publishedAt)} />
                <span className="min-w-0 truncate text-white/90" style={{ fontSize }}>
                  {v.title}
                </span>
              </span>
            </TileRowLink>
          ))}
        />
      )}
    </BigTile>
  )
}
