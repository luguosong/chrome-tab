import { changelogSourceOf, getChangelogSource } from 'chrome-tab-shared'
import { useChangelog } from '../hooks/useChangelog'
import { timeAgo } from '../lib/timeAgo'
import { tileFont } from '../lib/iconLayout'
import { useLayoutSettings } from '../context/LayoutSettingsContext'
import type { Icon } from '../lib/types'
import BigTile from './BigTile'

/** 榜单最多渲染行数:全量 300+ 版 DOM 无谓(看全量走「更多」Modal),30 行远超 tile 滚动可读量。 */
const MAX_ROWS = 30

/** 新版本红点窗口:发布 <24h 的版本行带红点;时间驱动,满窗自然消失(无已读状态)。 */
const NEW_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * 更新日志图标的专属网格渲染(非单例、每实例绑一个外源,ADR-0020;ADR-0022 跨格
 * 第二消费者):外壳/标头走 BigTile(ADR-0022 抽取),主体 = 单列滚动版本榜(一行一
 * 版本:版本号 mono + 相对时间;最新版 accent,与 Modal「最新」药丸同强调;发布
 * <24h 的版本行前置红点新标记(时间驱动满窗自隐,无时间同时间列降级);行不可点
 * → 不做 hover 高亮,免暗示交互)。版本时间 = 后端 releaseTimes 全表(ADR-0022),
 * 发布信息失败/版本号错位条目降级不显示时间;标头鲜度回退 releasedAt——重启恢复窗口
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
  const { iconScale } = useLayoutSettings()
  const versions = data?.versions ?? []
  const times = data?.releaseTimes ?? {}
  const latest = versions[0]
  const fresh = latest ? (times[latest.title] ?? data?.releasedAt ?? null) : null
  const fontSize = tileFont(iconScale, 'secondary')
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
        <ol
          // 原生滚动翻阅(雾胶囊滚动条 tile-scroll,触屏 pan-y 保原生滚动,TouchSensor 分流拖拽),同 aihot
          className="flex-1 min-h-0 overflow-y-auto flex flex-col px-2 py-1.5 tile-scroll [touch-action:pan-y]"
        >
          {versions.slice(0, MAX_ROWS).map((v, i) => {
            const at = times[v.title]
            // 24h 内发布 → 红点;无时间(错位/降级)同时间列降级,不标
            const isNew = !!at && Date.now() - new Date(at).getTime() < NEW_WINDOW_MS
            return (
              <li
                key={v.title}
                className="flex items-baseline justify-between gap-2 min-w-0 px-2 py-1 rounded-lg"
              >
                <span className="flex min-w-0 items-baseline gap-1.5">
                  {isNew && (
                    <span
                      className="h-1.5 w-1.5 shrink-0 self-center rounded-full bg-red-400"
                      aria-hidden="true"
                    />
                  )}
                  <span
                    className={'font-mono min-w-0 truncate ' + (i === 0 ? 'text-accent' : 'text-white/85')}
                    style={{ fontSize }}
                    title={v.title}
                  >
                    {v.title}
                  </span>
                </span>
                {at && (
                  <span className="font-mono shrink-0 text-white/40" style={{ fontSize }}>
                    {timeAgo(at)}
                  </span>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </BigTile>
  )
}
