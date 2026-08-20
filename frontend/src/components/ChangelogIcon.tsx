import { useChangelog } from '../hooks/useChangelog'
import { useLayoutSettings } from '../context/LayoutSettingsContext'
import type { Icon } from '../lib/types'

/**
 * 更新日志图标的专属网格渲染(单例;ADR-0016 单档极简:1×1 只显示 最新版本号 + 发布日期)。
 * 完整版本列表走底部 Drawer(ChangelogDrawer)。数据直接订阅 useChangelog(与
 * IconDataContext 同 queryKey,命中缓存零额外请求,同 GroupBody 用 useConfig 的先例);
 * 发布日期来自后端 npm registry 代理(ADR-0016),失败/无数据降级 —。
 *
 * 防遮蔽防溢出:两行均 truncate(不穿框);画格高度极端不足时容器查询隐日期行
 * 保版本号(cl-date,断点见 globals.css)。字号随 iconScale 同比缩放。
 */
export default function ChangelogIconBody({ icon: _icon }: { icon: Icon }) {
  const { iconScale } = useLayoutSettings()
  const px = (n: number) => n * iconScale
  const { data } = useChangelog()
  const latest = data?.versions[0]?.title ?? null
  // ISO(UTC)前 10 位 = YYYY-MM-DD
  const date = data?.releasedAt ? data.releasedAt.slice(0, 10) : null

  return (
    <div className="w-full max-h-full overflow-hidden min-w-0 flex flex-col justify-center gap-1">
      <span
        className="font-mono text-accent leading-none truncate"
        style={{ fontSize: px(14) }}
      >
        {latest ?? '--'}
      </span>
      <span
        className="cl-date font-mono text-white/60 leading-none truncate"
        style={{ fontSize: px(9) }}
      >
        {date ?? '—'}
      </span>
    </div>
  )
}
