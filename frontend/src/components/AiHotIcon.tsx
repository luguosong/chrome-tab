import { useAiHot } from '../hooks/useAiHot'
import { timeAgo } from '../lib/aihot'
import { extractString } from '../lib/iconData'
import { faviconPx, tileFont } from '../lib/iconLayout'
import { useEditMode } from '../context/EditModeContext'
import { useLayoutSettings } from '../context/LayoutSettingsContext'
import type { Icon } from '../lib/types'

/**
 * AI 热点图标的专属网格渲染(见 CONTEXT.md「AI 热点」;ADR-0021 跨格大 tile):
 * 3×2 大 tile,不复用单格外壳 Tile(其 aspect-square/bound 钳制是 1×1 几何)——块自身
 * 玻璃材质(glass-soft)+ container-type 字号档照旧,尺寸交给画格 span(Icon.tsx)撑满。
 * 块内 = 标头(data.name + 榜首鲜度)→ hairline → 单列滚动新闻流(一行一条,标题
 * 最多两行:超一行自动换行、超两行 line-clamp 省略——中文热点标题 20~40 字基本
 * 完整可读;序号锚第一行基线,top-3 accent)。点击派发:条目链接
 * stopPropagation 外跳 AIHOT 事件页;点其余区域(标头/空隙)冒泡到外层 Icon Tag
 * 开详情 Modal(AiHotModal,完整榜单)。空榜/取数失败降级 ···(重试入口在 Modal)。
 * 数据自持 useAiHot。
 */
export default function AiHotIconBody({ icon, overlay = false }: { icon: Icon; overlay?: boolean }) {
  const { data } = useAiHot()
  const { editing } = useEditMode()
  const { iconScale } = useLayoutSettings()
  const name = extractString(icon.data, 'name') || 'AI 热点'
  const topics = data ?? []
  const fresh = topics[0]?.latestAt ?? null
  const fontSize = tileFont(iconScale, 'secondary')

  return (
    <div
      // 滚动/列表都在块内,圆角处裁切;select-none:点标头/空隙开 Modal 的区域防选中
      className="glass-soft rounded-3xl flex flex-col min-h-0 w-full flex-1 overflow-hidden select-none [container-type:inline-size]"
      // overlay 拖拽幽灵在画格外(无 span 画格),给固定近似尺寸保形态
      style={
        overlay
          ? {
              width: faviconPx(iconScale) * 3 + 24,
              height: faviconPx(iconScale) * 2 + 56,
              flex: 'none',
            }
          : undefined
      }
    >
      <div className="flex items-baseline justify-between gap-3 px-3.5 pt-2.5 pb-1.5 border-b border-white/10">
        <span className="truncate text-white/90" style={{ fontSize: tileFont(iconScale, 'primary') }}>
          {name}
        </span>
        {fresh && (
          <span className="font-mono shrink-0 text-white/50" style={{ fontSize }}>
            {timeAgo(fresh)}
          </span>
        )}
      </div>

      {topics.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-white/40" style={{ fontSize }}>
          ···
        </div>
      ) : (
        <ol
          // 原生滚动翻阅全量(隐藏滚动条,触屏 pan-y 保原生滚动,TouchSensor
          // delay+tolerance 分流拖拽)。单列(2026-08-23 迭代,原双列):一行一条,
          // 标题 line-clamp-2——「更多文字」由宽度×两行满足,字号维持 secondary 档
          className="flex-1 min-h-0 overflow-y-auto flex flex-col px-2 py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [touch-action:pan-y]"
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
    </div>
  )
}
