import { changelogSourceOf, getChangelogSource, isLtsVersion, isPrereleaseVersion } from 'chrome-tab-shared'
import { useChangelog } from '../hooks/useChangelog'
import { timeAgo } from '../lib/timeAgo'
import { isFreshRow } from '../lib/tileBody'
import { ICON_SCALE, tileFont } from '../lib/iconLayout'
import type { Icon } from '../lib/types'
import BigTile from './BigTile'
import { FreshDot, TileBody, TileRow } from './TileBody'

/**
 * 更新日志图标的专属网格渲染(非单例、每实例绑一个外源,ADR-0020;ADR-0022 跨格
 * 第二消费者):外壳/标头走 BigTile(ADR-0022 抽取),主体 = 单列滚动版本榜(块内
 * 主体骨架走 TileBody,见 CONTEXT.md「块内主体」;剔预发布(ADR-0050:信号位,预发布
 * 刷屏毁红点信号,Modal 全览位仍全量);一行一版本:版本号 mono + 相对
 * 时间;最新版 accent,与 Modal「最新」药丸同强调;发布 <24h 的版本行前置红点新
 * 标记(时间驱动满窗自隐,无时间同时间列降级);行不可点 → 不做 hover 高亮,免暗
 * 示交互 = TileRow 静态臂)。版本时间 = 后端 releaseTimes 全表(ADR-0022),发布
 * 信息失败/版本号错位条目降级不显示时间;标头鲜度回退 releasedAt——重启恢复窗口
 * (快照表只有 released_at 列)靠它显示。整块点击无操作(ADR-0022):详情唯一入口 =
 * 「更多」按钮(ChangelogModal)。空榜/取数失败降级 ···(BigTile 空态)。
 * 数据按源经 useChangelog 拉取(同源共享缓存)。
 */
export default function ChangelogIconBody({
  icon,
  overlay = false,
  onOpenDetail,
}: {
  icon: Icon
  overlay?: boolean
  /** 「更多」按钮直调(ADR-0022);undefined = 编辑模式/overlay,按钮不渲染。 */
  onOpenDetail?: () => void
}) {
  // data.source 读侧兜底:存量 data=null 图标归默认源(ADR-0020)
  const source = changelogSourceOf(icon.data)
  const { data } = useChangelog(source)
  const times = data?.releaseTimes ?? {}
  // 块内信号位剔预发布(ADR-0050):预发布发布频繁(如 codex alpha 日均 2-3 个)近乎常亮
  // 红点,稀释「正式版更新了」的信号;Modal 全览位仍全量。最新版/鲜度随过滤后口径。
  const versions = (data?.versions ?? []).filter((v) => !isPrereleaseVersion(v.title))
  const latest = versions[0]
  const fresh = latest ? (times[latest.title] ?? data?.releasedAt ?? null) : null
  const fontSize = tileFont(ICON_SCALE, 'secondary')
  const sourceDef = getChangelogSource(source)

  return (
    <BigTile
      title={sourceDef.label}
      link={
        onOpenDetail
          ? { href: sourceDef.repositoryUrl, label: '仓库', title: `打开 ${sourceDef.label} 仓库` }
          : undefined
      }
      fresh={fresh}
      onOpenDetail={onOpenDetail}
      moreTitle="查看完整更新日志"
      overlay={overlay}
    >
      {versions.length === 0 ? null : (
        <TileBody
          rows={versions.map((v, i) => {
            const at = times[v.title]
            return (
              // 静态行(TileRow 省缺臂):不可点,不做 hover 免暗示交互;最新版 accent
              <TileRow key={v.title} className="flex items-baseline justify-between gap-2 min-w-0">
                <span className="flex min-w-0 items-baseline gap-1.5">
                  <FreshDot show={isFreshRow(at)} />
                  <span
                    className={'font-mono min-w-0 truncate ' + (i === 0 ? 'text-accent' : 'text-white/85')}
                    style={{ fontSize }}
                    title={v.title}
                  >
                    {v.title}
                  </span>
                  {isLtsVersion(v.title, sourceDef) && (
                    <span className="shrink-0 text-white/40" style={{ fontSize }}>
                      LTS
                    </span>
                  )}
                </span>
                {at && (
                  <span className="font-mono shrink-0 text-white/40" style={{ fontSize }}>
                    {timeAgo(at)}
                  </span>
                )}
              </TileRow>
            )
          })}
        />
      )}
    </BigTile>
  )
}
