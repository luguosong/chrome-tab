import { changelogSourceOf, getChangelogSource } from 'chrome-tab-shared'
import { useChangelog } from '../hooks/useChangelog'
import type { Icon } from '../lib/types'
import Tile, { TilePrimary } from './Tile'

/**
 * 更新日志图标的专属网格渲染(非单例、每实例绑一个外源,ADR-0020;ADR-0016 单档;
 * 注记 2026-08-23c/f 块内两行):块内 = 「最后更新版本(mono accent)+ 发布日期
 * (mono 白,同主行档——用户要求日期更醒目;ISO 月-日,年份归 Drawer)」——当前状态;
 * 下方名称行取源 label = 这是什么。完整版本列表与译文走底部 Drawer(ChangelogDrawer,
 * 按图标 data.source 打开对应源)。数据按源经 useChangelog 拉取(同源多图标共享
 * queryKey 缓存);releasedAt = 后端 npm registry 代理的最新版发布时间(ADR-0016),
 * 失败/无数据降级 —。「上块下字」组装与字号档(ADR-0016 注记 e)归 Tile。
 */
export default function ChangelogIconBody({ icon, overlay = false }: { icon: Icon; overlay?: boolean }) {
  // data.source 读侧兜底:存量 data=null 图标归默认源(ADR-0020)
  const source = changelogSourceOf(icon.data)
  const { data } = useChangelog(source)
  const latest = data?.versions[0]?.title ?? null
  const released = data?.releasedAt

  return (
    <Tile label={getChangelogSource(source).label} overlay={overlay}>
      <TilePrimary className="font-mono text-accent">{latest ?? '—'}</TilePrimary>
      {released && <TilePrimary className="font-mono text-white">{released.slice(5, 10)}</TilePrimary>}
    </Tile>
  )
}
