import { useAiHot } from '../hooks/useAiHot'
import { extractString } from '../lib/iconData'
import { tileFont } from '../lib/iconLayout'
import { useEditMode } from '../context/EditModeContext'
import { useLayoutSettings } from '../context/LayoutSettingsContext'
import type { Icon } from '../lib/types'
import BigTile from './BigTile'

/**
 * AI 热点图标的专属网格渲染(见 CONTEXT.md「AI 热点」;ADR-0021 跨格大 tile):
 * 外壳/标头走 BigTile(ADR-0022 抽取),主体 = 单列滚动新闻流(一行一条,标题
 * 最多两行:超一行自动换行、超两行 line-clamp 省略——中文热点标题 20~40 字基本
 * 完整可读;序号锚第一行基线,top-3 accent)。点击派发(ADR-0022):整块点击
 * 无操作,详情 Modal(AiHotModal,完整榜单)入口 = 标头「更多」按钮;标题即
 * 外链直达 AIHOT 站点(同待办标题直达收集箱);条目链接 stopPropagation 外跳
 * AIHOT 事件页照旧。空榜/取数失败降级 ···(BigTile 空态,重试入口在 Modal)。
 * 数据自持 useAiHot。
 */
export default function AiHotIconBody({
  icon,
  overlay = false,
  onOpenDetail,
}: {
  icon: Icon
  overlay?: boolean
  /** 「更多」按钮直调(ADR-0022);undefined = 编辑模式/overlay,按钮不渲染。 */
  onOpenDetail?: () => void
}) {
  const { data } = useAiHot()
  const { editing } = useEditMode()
  const { iconScale } = useLayoutSettings()
  const name = extractString(icon.data, 'name') || 'AI 热点'
  const topics = data ?? []
  const fresh = topics[0]?.latestAt ?? null
  const fontSize = tileFont(iconScale, 'secondary')

  return (
    <BigTile
      title={name}
      titleHref="https://aihot.virxact.com/"
      titleLinkHint="打开 AIHOT 站点"
      fresh={fresh}
      onOpenDetail={onOpenDetail}
      moreTitle="查看完整榜单"
      overlay={overlay}
    >
      {topics.length === 0 ? null : (
        <ol
          // 原生滚动翻阅全量(雾胶囊滚动条 tile-scroll,触屏 pan-y 保原生滚动,
          // TouchSensor delay+tolerance 分流拖拽)。单列(2026-08-23 迭代,原双列):
          // 一行一条,标题 line-clamp-2——「更多文字」由宽度×两行满足,字号维持 secondary 档
          className="flex-1 min-h-0 overflow-y-auto flex flex-col px-2 py-1.5 tile-scroll [touch-action:pan-y]"
        >
          {topics.map((t) => (
            <li
              key={t.rank}
              className="flex items-baseline gap-2 min-w-0 px-2 py-1 rounded-lg hover:bg-white/10 transition"
            >
              <span
                className={
                  'font-mono shrink-0 w-4 text-right tabular-nums ' +
                  (t.rank <= 3 ? 'text-accent' : 'text-white/40')
                }
                style={{ fontSize }}
              >
                {t.rank}
              </span>
              {t.storyUrl && !editing ? (
                <a
                  href={t.storyUrl}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  title={t.title}
                  className="min-w-0 line-clamp-2 text-white/90 hover:text-accent"
                  style={{ fontSize }}
                >
                  {t.title}
                </a>
              ) : (
                <span className="min-w-0 line-clamp-2 text-white/90" title={t.title} style={{ fontSize }}>
                  {t.title}
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </BigTile>
  )
}
