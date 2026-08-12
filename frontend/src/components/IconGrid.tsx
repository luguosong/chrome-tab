import type { CSSProperties, ReactNode } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, rectSortingStrategy } from '@dnd-kit/sortable'
import type { Icon, Page } from '../lib/types'
import { GRID_COLUMNS, GRID_ROWS } from '../lib/iconLayout'
import { DEFAULT_PAGE_CAPACITY, cellsUsed } from '../lib/iconCapacity'
import { useEditMode } from '../context/EditModeContext'
import { useLayoutSettings } from '../context/LayoutSettingsContext'
import IconView from './Icon'

/**
 * 单页图标网格(见 spec §前端架构 IconGrid)。
 *
 * 固定 8×8 CSS grid + dense 自动流,图标按 size 跨格(small=1×1 / medium=2×2 / large=3×2)。
 * section 自身透明(玻璃背景由 DashboardPage 的整页面板提供),走 h-full 填满走马灯 slide,
 * gridTemplateRows 显式锁定 8 行,故网格区域大小由视口布局决定、不随图标数量变化(空页与满页同尺寸)。
 * 拖拽(06):整页用一个 SortableContext 包裹,items=本页 iconId,grid 布局用
 * rectSortingStrategy(多尺寸 grid 的推荐 strategy);根 DndContext 由 DashboardPage 提供。
 *
 * 自动流策略:用 grid-auto-flow:dense 让小图标填充大图标之间的空隙。
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
  const { gridWidth, gridGap } = useLayoutSettings()
  // 剩余格数角标(spec user story 42):容量取 DEFAULT_PAGE_CAPACITY(与后端最终校验一致),
  // 纯函数 cellsUsed 累加本页图标占用(icons 已由调用方按 pageId 过滤)。
  const remaining = DEFAULT_PAGE_CAPACITY - cellsUsed(icons)

  if (icons.length === 0) {
    return (
      <section className="p-2 w-full h-full flex flex-col">
        <h2 className="text-sm font-medium tracking-wide text-white/85 mb-4 text-center">
          {page.name}
          {editing && <CapacityBadge remaining={remaining} />}
        </h2>
        {/* 空页落点(07 限制修复):空页无 sortable 项,挂页级 useDroppable(id=页 id)
            让 dnd-kit 碰撞检测可命中,DashboardPage.onDragOver 据此把图标移入本页(位序 0)。
            一旦图标乐观移入,本页变非空,改由 SortableContext 接管。 */}
        <PageDropArea pageId={page.id}>
          <div className="flex-1 min-h-0 flex items-center justify-center text-white/50 text-sm">
            此页暂无图标
          </div>
        </PageDropArea>
      </section>
    )
  }

  // 固定 8×8:列与行都显式锁定 8 条轨道(1fr)。行用 minmax(0,1fr) 允许在固定画布内收缩,
  // 配合外层 h-full,无论图标多少背景高度恒定。
  const style: CSSProperties = {
    gridTemplateColumns: `repeat(${GRID_COLUMNS}, minmax(0, 1fr))`,
    gridTemplateRows: `repeat(${GRID_ROWS}, minmax(0, 1fr))`,
    gridAutoFlow: 'dense',
    maxWidth: gridWidth,
    gap: gridGap,
  }

  return (
    <section className="p-2 w-full h-full flex flex-col">
      <h2 className="text-sm font-medium tracking-wide text-white/85 mb-4 text-center">
        {page.name}
        {editing && <CapacityBadge remaining={remaining} />}
      </h2>
      <div className="grid flex-1 min-h-0 w-full mx-auto" style={style} role="grid">
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

/**
 * 空页的整页落点区(07 限制修复)。空页没有 sortable 项供 dnd-kit 命中——dnd-kit 的
 * droppable 矩形来自每个 useSortable 项,SortableContext 自身不注册矩形——故挂一个
 * useDroppable:id=页 id 字符串,data.type='page' 让 DashboardPage.onDragOver 识别为
 * 「落入空页」而非某个图标,移入位序 0。data-page-droppable 便于调试/测试定位。
 * 图标乐观移入后本页变非空,改由 SortableContext 接管,此 droppable 卸载,无 id 冲突。
 */
function PageDropArea({ pageId, children }: { pageId: number; children: ReactNode }) {
  const { setNodeRef } = useDroppable({
    id: String(pageId),
    data: { type: 'page' as const, pageId },
  })
  return (
    <div ref={setNodeRef} data-page-droppable={pageId} className="flex-1 min-h-0 flex">
      {children}
    </div>
  )
}
