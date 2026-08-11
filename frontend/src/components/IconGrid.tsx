import type { CSSProperties } from 'react'
import { SortableContext, rectSortingStrategy } from '@dnd-kit/sortable'
import type { Icon, Page } from '../lib/types'
import { GRID_COLUMNS } from '../lib/iconLayout'
import { DEFAULT_PAGE_CAPACITY, cellsUsed } from '../lib/iconCapacity'
import { useEditMode } from '../context/EditModeContext'
import IconView from './Icon'

/**
 * 单页图标网格(见 spec §前端架构 IconGrid)。
 *
 * 6 列 CSS grid + dense 自动流,图标按 size 跨格(small=1×1 / medium=2×2 / large=3×2)。
 * 拖拽(06):整页用一个 SortableContext 包裹,items=本页 iconId,grid 布局用
 * rectSortingStrategy(多尺寸 grid 的推荐 strategy);根 DndContext 由 DashboardPage 提供。
 *
 * 自动流策略:用 grid-auto-flow:dense 让小图标填充大图标之间的空隙,迁移后默认页布局
 * (12 small + 1 large + 13 medium)在 6×4 视口下视觉紧凑。
 */
export default function IconGrid({
  page,
  icons,
  onOpenDetail,
}: {
  page: Page
  icons: Icon[]
  onOpenDetail?: (icon: Icon) => void
}) {
  const { editing } = useEditMode()
  // 剩余格数角标(spec user story 42):容量取 DEFAULT_PAGE_CAPACITY(与后端最终校验一致),
  // 纯函数 cellsUsed 累加本页图标占用(icons 已由调用方按 pageId 过滤)。
  const remaining = DEFAULT_PAGE_CAPACITY - cellsUsed(icons)

  if (icons.length === 0) {
    return (
      <section className="glass-panel rounded-3xl p-6 mx-auto max-w-3xl">
        <h2 className="text-xs uppercase tracking-wider text-white/70 mb-4 text-center">
          {page.name}
          {editing && <CapacityBadge remaining={remaining} />}
        </h2>
        <div className="text-white/50 text-sm py-8 text-center">此页暂无图标</div>
      </section>
    )
  }

  const style: CSSProperties = {
    gridTemplateColumns: `repeat(${GRID_COLUMNS}, minmax(0, 1fr))`,
    gridAutoFlow: 'dense',
    gridAutoRows: 'minmax(64px, auto)',
  }

  return (
    <section className="glass-panel rounded-3xl p-6 mx-auto max-w-3xl">
      <h2 className="text-xs uppercase tracking-wider text-white/70 mb-4 text-center">
        {page.name}
        {editing && <CapacityBadge remaining={remaining} />}
      </h2>
      <div className="grid gap-3" style={style} role="grid">
        {/* id=页 id 字符串:dnd-kit 把它作为本页 sortable 项的 containerId 写入其 data,
            DashboardPage 的 onDragOver 据 over.data.current.sortable.containerId 判断跨页(issue 07)。 */}
        <SortableContext id={String(page.id)} items={icons.map((i) => i.id)} strategy={rectSortingStrategy}>
          {icons.map((icon) => (
            <IconView key={icon.id} icon={icon} onOpenDetail={onOpenDetail} />
          ))}
        </SortableContext>
      </div>
    </section>
  )
}

/**
 * 编辑模式下的剩余格数角标(spec user story 42)。
 * 内联在页标题右侧;剩余 ≤0 时显示"已满"提示。
 */
function CapacityBadge({ remaining }: { remaining: number }) {
  if (remaining <= 0) {
    return <span className="ml-2 text-accent normal-case tracking-normal">· 已满</span>
  }
  return (
    <span className="ml-2 text-white/50 normal-case tracking-normal">· 剩 {remaining} 格</span>
  )
}
