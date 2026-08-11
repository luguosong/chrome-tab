import { useMemo, useState, type CSSProperties } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { get, sizesFor, type Summary, type SummaryInput } from '../lib/iconTypeRegistry'
import { inline } from '../lib/changelogParser'
import type { Icon as IconModel, IconSize } from '../lib/types'
import { useIconData } from '../context/IconDataContext'
import { useEditMode } from '../context/EditModeContext'
import { SIZE_CELLS } from '../lib/iconLayout'
import { extractString } from '../lib/iconData'
import { useDeleteIcon, useUpdateIconSize } from '../api/config'

/**
 * 单个图标渲染(见 CONTEXT.md「图标」/ spec §前端架构 IconGrid)。
 *
 * 按 size 决定信息密度:
 *   - small  (1×1):仅 favicon
 *   - medium (2×2):favicon + 名称
 *   - large  (3×2):favicon + 名称 + 实时摘要(调用类型注册表 summarize)
 *
 * 点击行为(10 ticket,按 detail 字段派发 —— ADR-0001 契约:容器形态由类型定义声明,
 * 新增复用 modal/drawer 的类型无需改本组件):
 *   - 编辑模式:不触发任何详情/跳转(角标操作优先,spec user story 29)
 *   - detail='none':nav 渲染为 <a>(新标签打开目标 URL,spec user story 13)
 *   - detail='modal'/'drawer':查看态点击 → onOpenDetail(icon),父组件按 detail 渲染面板
 *
 * 刷新失败降级:summarize 返回 null → 摘要行显示灰色 "--"(spec user story 14)。
 *
 * 拖拽(06):本组件是网格画格(grid item,拥有 gridColumn/gridRow span),故 useSortable
 * 直接挂在此处——sortable 节点必须即画格节点,否则 grid 跨度会失效。仅编辑模式启用
 * (disabled: !editing);非编辑模式下不注入 attributes/listeners,保留 nav `<a>` 原生
 * 语义(role=link)与点击行为。data 带 pageId/size 供 DndContext handler 读取(跨页 07 用)。
 * 编辑模式角标(EditActions)的交互按钮 onPointerDown stopPropagation,避免点角标误启拖拽。
 */
const SIZE_STYLE: Record<IconSize, { pad: string; favicon: string }> = {
  small: { pad: 'p-2', favicon: 'w-8 h-8' },
  medium: { pad: 'p-3', favicon: 'w-10 h-10' },
  large: { pad: 'p-4', favicon: 'w-12 h-12' },
}

/** 编辑模式尺寸菜单与角标的中文标签(spec user story 28:大/中/小三档)。 */
const SIZE_LABEL: Record<IconSize, string> = {
  small: '小',
  medium: '中',
  large: '大',
}

export default function Icon({
  icon,
  onOpenDetail,
  overlay = false,
}: {
  icon: IconModel
  onOpenDetail?: (icon: IconModel) => void
  /**
   * DragOverlay 中的拖拽幽灵(06):由 DashboardPage 在拖拽期间渲染一份只读副本跟随光标,
   * 原位置降级为占位(dimmed)。overlay 模式下不挂载 sortable 接线、不渲染编辑角标、
   * 不应用 jiggle,仅复用本组件的视觉(favicon/名称/摘要)以保证幽灵与原图标一致。
   */
  overlay?: boolean
}) {
  const def = get(icon.type)
  const { quotes, changelog } = useIconData()
  const { editing } = useEditMode()
  const delIcon = useDeleteIcon()
  const resizeIcon = useUpdateIconSize()
  const [menuOpen, setMenuOpen] = useState(false)

  // 拖拽(06):仅编辑模式可拖;data 带 pageId/size 供 DndContext handler 读取(见 issue 06 checklist)。
  // overlay 副本强制 disabled,避免在 DragOverlay(脱离 SortableContext)里重复注册可拖节点。
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: icon.id,
    data: { pageId: icon.pageId, size: icon.size },
    disabled: !editing || overlay,
  })

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
    // 拖拽变换仅作用于网格内本体(06);overlay 幽灵由 DragOverlay 负责定位,不重复套 transform。
    ...(!overlay
      ? {
          transform: CSS.Transform.toString(transform),
          transition,
          ...(isDragging ? { opacity: 0.4, zIndex: 20 } : null),
        }
      : null),
  }
  const sz = SIZE_STYLE[icon.size]

  const name = extractName(icon)
  const url = icon.type === 'nav' ? extractString(icon.data, 'url') : ''
  const favicon = url ? faviconUrl(url) : ''

  // 点击派发:编辑模式一律不触发;查看模式按 detail 字段(ADR-0001 契约:容器形态由类型定义声明)
  //   - detail='none':nav 渲染为 <a target=_blank> 新标签打开(保留原生中键/右键菜单)
  //   - detail='modal'/'drawer':点击 → onOpenDetail,由父组件按 detail 渲染对应面板
  const isNavLink = icon.type === 'nav' && !editing
  const Tag = isNavLink ? 'a' : 'div'
  const linkProps = isNavLink
    ? { href: url, target: '_blank' as const, rel: 'noreferrer' }
    : {}
  const hasPanel = def?.detail === 'modal' || def?.detail === 'drawer'
  const onClick = !editing && hasPanel && onOpenDetail ? () => onOpenDetail(icon) : undefined

  const interactive = !editing && (isNavLink || onClick !== undefined)

  return (
    <Tag
      ref={overlay ? undefined : setNodeRef}
      style={style}
      {...linkProps}
      {...(editing && !overlay ? attributes : {})}
      {...(editing && !overlay ? listeners : {})}
      onClick={onClick}
      title={def?.label}
      className={
        'relative flex flex-col items-center justify-center gap-2 rounded-2xl ' +
        'bg-white/15 hover:bg-white/30 transition ' +
        (interactive ? 'cursor-pointer' : 'cursor-default') +
        (editing && !overlay ? ' editing-jiggle cursor-grab active:cursor-grabbing' : '') +
        (isDragging && !overlay ? ' ring-2 ring-accent' : '') +
        (overlay ? ' shadow-2xl ring-2 ring-accent cursor-grabbing' : '') +
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

      {/* 编辑模式角标:尺寸切换菜单 + 删除 ×(spec user story 27/28)。
          仅展示该类型支持的尺寸(sizesFor);点击 PATCH 改 size,× 点击 DELETE,
          乐观更新 + 失败回滚见 api/config.ts。stopPropagation 避免冒泡到 Tag。
          overlay 幽灵不渲染角标(拖拽副本不带交互控件)。 */}
      {editing && !overlay && (
        <EditActions
          icon={icon}
          menuOpen={menuOpen}
          setMenuOpen={setMenuOpen}
          busy={delIcon.isPending || resizeIcon.isPending}
          onDelete={() => delIcon.mutate(icon.id)}
          onResize={(size) => resizeIcon.mutate({ id: icon.id, size })}
        />
      )}
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

/**
 * 编辑模式角标集群(右上角):尺寸切换菜单 + 删除 ×。
 * 尺寸菜单仅列该类型支持的尺寸(sizesFor,spec:仅展示该类型支持的尺寸)。
 * 菜单用 fixed 透明遮罩实现 click-outside 关闭(无需 document 监听)。
 * 所有点击 stopPropagation,避免冒泡到图标 Tag(编辑态 Tag 本就无 onClick,纯防御)。
 * onPointerDown 也 stopPropagation(06 拖拽):否则在角标上长按会触发 PointerSensor
 * 启动拖拽而非点击角标;阻止指针事件冒泡到挂载 listeners 的 Tag。
 */
function EditActions({
  icon,
  menuOpen,
  setMenuOpen,
  busy,
  onDelete,
  onResize,
}: {
  icon: IconModel
  menuOpen: boolean
  setMenuOpen: (v: boolean) => void
  busy: boolean
  onDelete: () => void
  onResize: (size: IconSize) => void
}) {
  const allowed = sizesFor(icon.type)
  // 单尺寸类型(如 changelog 仅 large)无需切换,不渲染尺寸按钮,只留删除 ×。
  const showSizeMenu = allowed.length > 1
  return (
    <>
      <div
        className="absolute -top-2 -right-2 z-20 flex gap-1"
        onPointerDown={(e) => e.stopPropagation()}
      >
        {/* 尺寸切换:显示当前档位,点击展开菜单(仅多尺寸类型出现) */}
        {showSizeMenu && (
          <button
            type="button"
            disabled={busy}
            onClick={(e) => {
              e.stopPropagation()
              setMenuOpen(!menuOpen)
            }}
            onContextMenu={(e) => e.stopPropagation()}
            className="glass-panel w-6 h-6 rounded-full text-[11px] font-semibold text-white/90 flex items-center justify-center hover:bg-white/40 disabled:opacity-50"
            title="切换尺寸"
          >
          {SIZE_LABEL[icon.size]}
          </button>
        )}
        {/* 删除 × */}
        <button
          type="button"
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
          onContextMenu={(e) => e.stopPropagation()}
          className="w-6 h-6 rounded-full bg-accent text-white text-sm leading-none flex items-center justify-center hover:bg-accent/80 disabled:opacity-50"
          title="删除"
        >
          ×
        </button>
      </div>

      {/* 尺寸菜单:展开时列出该类型支持的尺寸,当前档位高亮 */}
      {menuOpen && (
        <>
          {/* 透明遮罩:点击任意处关闭菜单 */}
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation()
              setMenuOpen(false)
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className="fixed inset-0 z-30 cursor-default"
          />
          <div
            className="absolute top-5 right-0 z-40 glass-panel rounded-lg py-1 min-w-[64px]"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {allowed.map((s) => {
              const current = s === icon.size
              return (
                <button
                  key={s}
                  type="button"
                  disabled={busy || current}
                  onClick={(e) => {
                    e.stopPropagation()
                    onResize(s)
                    setMenuOpen(false)
                  }}
                  className={
                    'block w-full text-left px-3 py-1 text-xs text-white/90 hover:bg-white/30 ' +
                    (current ? 'text-accent font-semibold' : '')
                  }
                >
                  {SIZE_LABEL[s]}
                </button>
              )
            })}
          </div>
        </>
      )}
    </>
  )
}
