import type { ReactNode } from 'react'
import { timeAgo } from '../lib/timeAgo'
import { faviconPx, tileFont } from '../lib/iconLayout'
import { useLayoutSettings } from '../context/LayoutSettingsContext'
import MoreButton from './MoreButton'

/**
 * 跨格大 tile 通用外壳(ADR-0022 抽取,aihot 与 changelog 两消费者):玻璃容器
 * (尺寸交给画格 span 撑满;overlay 拖拽幽灵在画格外,给固定近似尺寸保形态)+
 * 标头(名称 + 鲜度 + 「更多」按钮 = 详情唯一入口)+ 主体(children;null 时
 * 空态 ···)。不复用单格外壳 Tile——其 aspect-square/bound 钳制是 1×1 几何
 * (ADR-0021)。列表条目字号档由各调用方按 secondary 档自取。
 */
export default function BigTile({
  title,
  titleHref,
  titleLinkHint,
  fresh,
  onOpenDetail,
  moreTitle,
  overlay = false,
  children,
}: {
  /** 标头左侧名称。 */
  title: string
  /** 标题直达外链(新 tab);undefined = 纯文本。 */
  titleHref?: string
  /** 标题外链的悬浮提示(有 titleHref 才用)。 */
  titleLinkHint?: string
  /** 榜首/最新版鲜度(ISO);null 不显示。 */
  fresh: string | null
  /** 「更多」按钮直调(ADR-0022);undefined = 编辑模式/overlay,按钮不渲染。 */
  onOpenDetail?: () => void
  /** 「更多」按钮悬浮提示。 */
  moreTitle: string
  overlay?: boolean
  /** 主体(滚动榜单等);null = 空态/取数失败降级 ···(重试入口在 Modal)。 */
  children: ReactNode
}) {
  const { iconScale } = useLayoutSettings()
  const fontSize = tileFont(iconScale, 'secondary')
  return (
    <div
      // 滚动/列表都在块内,圆角处裁切;select-none:块内无选中诉求
      className="glass-soft rounded-3xl flex flex-col min-h-0 w-full flex-1 overflow-hidden select-none [container-type:inline-size]"
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
        {titleHref ? (
          <a
            href={titleHref}
            target="_blank"
            rel="noreferrer"
            title={titleLinkHint}
            className="truncate text-white/90 hover:text-accent hover:underline underline-offset-4 transition-colors"
            style={{ fontSize: tileFont(iconScale, 'primary') }}
          >
            {title}
          </a>
        ) : (
          <span className="truncate text-white/90" style={{ fontSize: tileFont(iconScale, 'primary') }}>
            {title}
          </span>
        )}
        <span className="flex shrink-0 items-baseline gap-2.5">
          {fresh && (
            <span className="font-mono text-white/50" style={{ fontSize }}>
              {timeAgo(fresh)}
            </span>
          )}
          <MoreButton onClick={onOpenDetail} fontSize={fontSize} title={moreTitle} />
        </span>
      </div>
      {children ?? (
        <div className="flex-1 flex items-center justify-center text-white/40" style={{ fontSize }}>
          ···
        </div>
      )}
    </div>
  )
}
