import { useMemo, type CSSProperties } from 'react'
import { get, type Summary, type SummaryInput } from '../lib/iconTypeRegistry'
import { inline } from '../lib/changelogParser'
import type { Icon as IconModel, IconSize } from '../lib/types'
import { useIconData } from '../context/IconDataContext'
import { SIZE_CELLS } from '../lib/iconLayout'

/**
 * 单个图标渲染(见 CONTEXT.md「图标」/ spec §前端架构 IconGrid)。
 *
 * 按 size 决定信息密度:
 *   - small  (1×1):仅 favicon
 *   - medium (2×2):favicon + 名称
 *   - large  (3×2):favicon + 名称 + 实时摘要(调用类型注册表 summarize)
 *
 * 类型分发:nav 在非编辑模式下是 <a>(新标签打开);stock/changelog 的点击行为(详情 Modal/
 * Drawer)是 10 ticket 的范围,此处静态渲染。
 *
 * 刷新失败降级:summarize 返回 null → 摘要行显示灰色 "--"(spec user story 14)。
 */
const SIZE_STYLE: Record<IconSize, { pad: string; favicon: string }> = {
  small: { pad: 'p-2', favicon: 'w-8 h-8' },
  medium: { pad: 'p-3', favicon: 'w-10 h-10' },
  large: { pad: 'p-4', favicon: 'w-12 h-12' },
}

export default function Icon({ icon }: { icon: IconModel }) {
  const def = get(icon.type)
  const { quotes, changelog } = useIconData()

  // 实时摘要(只在大尺寸时计算)
  const summary = useMemo<Summary | null>(() => {
    if (icon.size !== 'large' || !def) return null
    const live: SummaryInput = { quotes, changelog: changelog?.[0] ?? null }
    return def.summarize(icon.data, live)
  }, [icon.size, icon.data, def, quotes, changelog])

  const span = SIZE_CELLS[icon.size]
  const style: CSSProperties = {
    gridColumn: `span ${span.cols}`,
    gridRow: `span ${span.rows}`,
  }
  const sz = SIZE_STYLE[icon.size]

  const name = extractName(icon)
  const url = icon.type === 'nav' ? extractString(icon.data, 'url') : ''
  const favicon = url ? faviconUrl(url) : ''

  // nav 是链接(新标签打开);其它类型本阶段无点击行为(10 ticket)
  const isLink = icon.type === 'nav'
  const Tag = isLink ? 'a' : 'div'
  const linkProps = isLink
    ? { href: url, target: '_blank' as const, rel: 'noreferrer' }
    : {}

  return (
    <Tag
      style={style}
      {...linkProps}
      title={def?.label}
      className={
        'relative flex flex-col items-center justify-center gap-2 rounded-2xl ' +
        'bg-white/15 hover:bg-white/30 transition ' +
        (isLink ? 'cursor-pointer' : 'cursor-default') +
        ' ' + sz.pad
      }
    >
      {favicon && (
        <img
          src={favicon}
          alt=""
          className={`${sz.favicon} rounded-lg`}
          referrerPolicy="no-referrer"
        />
      )}

      {/* small 仅 favicon;medium+ 显示名称 */}
      {icon.size !== 'small' && name && (
        <span className="text-xs text-white/90 max-w-full truncate text-center">
          {name}
        </span>
      )}

      {/* large:实时摘要行(失败降级 "--")*/}
      {icon.size === 'large' && <SummaryLine summary={summary} />}
    </Tag>
  )
}

/** 大尺寸图标的摘要行:有则高亮显示,无则灰色 "--"。带 inline markdown(版本号/价格)。 */
function SummaryLine({ summary }: { summary: Summary | null }) {
  if (!summary) {
    return <span className="font-mono text-[11px] text-white/40">--</span>
  }
  const toneCls =
    summary.tone === 'up' ? 'text-up' : summary.tone === 'down' ? 'text-down' : 'text-white/70'
  return (
    <div className="flex flex-col items-center gap-0.5 max-w-full">
      {summary.title && (
        <span
          className="font-mono text-[12px] text-accent max-w-full truncate"
          dangerouslySetInnerHTML={{ __html: inline(summary.title) }}
        />
      )}
      {summary.text && (
        <span
          className={`font-mono text-[11px] ${toneCls} max-w-full truncate`}
          dangerouslySetInnerHTML={{ __html: inline(summary.text) }}
        />
      )}
    </div>
  )
}

// ── 辅助 ──────────────────────────────────────────────────────────────────
function extractString(data: Record<string, unknown> | null, key: string): string {
  if (!data) return ''
  const v = data[key]
  return typeof v === 'string' ? v : ''
}

/** 各类型的显示名(nav/stock 用 data.name,changelog 用类型 label)。 */
function extractName(icon: IconModel): string {
  if (icon.type === 'changelog') return get('changelog')?.label ?? '更新日志'
  return extractString(icon.data, 'name')
}

/** nav 的 favicon:沿用旧 NavTileGroup 的 google s2 favicons 服务。 */
function faviconUrl(url: string): string {
  try {
    const domain = new URL(url).hostname
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`
  } catch {
    return ''
  }
}
