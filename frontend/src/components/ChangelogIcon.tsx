import { useIconData } from '../context/IconDataContext'
import type { Icon } from '../lib/types'
import Tile, { TilePrimary, TileSecondary } from './Tile'

/**
 * 更新日志图标的专属网格渲染(单例;ADR-0016 单档;注记 2026-08-23c 块内两行):
 * 块内 = 「最后更新版本(mono accent 主体)+ 发布日期(次级行,ISO 月-日,年份归
 * Drawer)」——当前状态;下方名称行「Claude Code」= 这是什么。完整版本列表与译文走
 * 底部 Drawer(ChangelogDrawer)。数据走 IconDataContext 集中下发(单例集中拉取的
 * 同一份 query,不再各自订阅 useChangelog);releasedAt = 后端 npm registry 代理的
 * 最新版发布时间(ADR-0016),失败/无数据降级 —。
 * 「上块下字」组装与字号档(ADR-0016 注记 e)归 Tile。
 */
export default function ChangelogIconBody({ icon: _icon, overlay = false }: { icon: Icon; overlay?: boolean }) {
  const { changelog, changelogReleasedAt } = useIconData()
  const latest = changelog?.[0]?.title ?? null
  const released = changelogReleasedAt

  return (
    <Tile label="Claude Code" overlay={overlay}>
      <TilePrimary className="font-mono text-accent">{latest ?? '—'}</TilePrimary>
      {released && <TileSecondary className="text-white/70">{released.slice(5, 10)}</TileSecondary>}
    </Tile>
  )
}
