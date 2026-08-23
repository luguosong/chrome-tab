import { useAiHot } from '../hooks/useAiHot'
import { timeAgo } from '../lib/aihot'
import { extractString } from '../lib/iconData'
import type { Icon } from '../lib/types'
import Tile, { TilePrimary, TileSecondary } from './Tile'

/**
 * AI 热点图标的专属网格渲染(见 CONTEXT.md「AI 热点」;ADR-0016 注记 b/c 块内两行):
 * 块内 = 榜首标题(primary 档截断)+ 源数·时长(mono 次行)——当前最热什么;
 * 下方名称行(默认「AI 热点」,data.name 可改)= 这是什么。完整榜单走详情 Modal
 * (AiHotModal,与天气同范式)。数据自持 useAiHot(单例无批量红利,不入集中层);
 * 榜空/取数失败降级 ···,取数失败的重试入口在 Modal。组装与字号档归 Tile。
 */
export default function AiHotIconBody({ icon, overlay = false }: { icon: Icon; overlay?: boolean }) {
  const { data } = useAiHot()
  const top = data?.[0] ?? null

  return (
    <Tile label={extractString(icon.data, 'name') || 'AI 热点'} overlay={overlay}>
      {top ? (
        <>
          <TilePrimary className="text-white/90">{top.title}</TilePrimary>
          <TileSecondary className="font-mono text-white/60">
            {top.sourceCount} 源{top.latestAt ? ` · ${timeAgo(top.latestAt)}` : ''}
          </TileSecondary>
        </>
      ) : (
        <span className="text-white/40 text-sm leading-none">···</span>
      )}
    </Tile>
  )
}
