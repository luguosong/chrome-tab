import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, rectSortingStrategy } from '@dnd-kit/sortable'
import type { Icon, Page } from '../lib/types'
import { GRID_COLUMNS, iconCellGeometry, labelBlockPx } from '../lib/iconLayout'
import { DEFAULT_PAGE_CAPACITY, cellsUsed } from '../lib/iconCapacity'
import { useEditMode } from '../context/EditModeContext'
import { useLayoutSettings } from '../context/LayoutSettingsContext'
import IconView from './Icon'

/**
 * 单页图标网格(见 spec §前端架构 IconGrid)。
 *
 * 固定 9×9 CSS grid,图标默认占 1 格(ADR-0016),声明 size 的类型 CSS span 跨格
 * (ADR-0021,见 Icon.tsx 的 style 注释)。
 * section 自身透明(玻璃背景由 DashboardPage 的整页面板提供),走 h-full 填满走马灯 slide,
 * grid 元素 flex-1 仍占满画布(空页与满页网格区域同尺寸),但**行轨道不再平分画布**:
 * gridAutoRows = 图标几何行高(实际占用的行才存在,簇 align-content:start 自上向下排列)——
 * 旧行为 repeat(8,1fr) 把画布强切 8 行,矮视口下图标被「画布高/8」钳死,iconScale 失效
 * (见 iconCellGeometry)。
 * 拖拽(06):整页用一个 SortableContext 包裹,items=本页 iconId,grid 布局用
 * rectSortingStrategy;根 DndContext 由 DashboardPage 提供。
 */
export default function IconGrid({
  page,
  icons,
  onOpenDetail,
  onOpenGroup,
}: {
  page: Page
  icons: Icon[]
  onOpenDetail?: (icon: Icon) => void
  /** 点组图标开分组弹层(票 08),透传给 Icon。 */
  onOpenGroup?: (icon: Icon) => void
}) {
  const { editing } = useEditMode()
  const { gridWidth, gridGap, gridGapY, iconScale, labelVisible, labelSize } = useLayoutSettings()
  // 剩余格数角标(spec user story 42):容量取 DEFAULT_PAGE_CAPACITY(与后端最终校验一致),
  // 纯函数 cellsUsed 累加本页图标格数(跨格类型按 w×h 计,ADR-0021;icons 已按 pageId 过滤)。
  const remaining = DEFAULT_PAGE_CAPACITY - cellsUsed(icons)

  // 画布实测(ResizeObserver):图标几何要钳制在真实轨道宽/画布高内(视口/设置变化即重算)。
  const gridRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = gridRef.current
    if (!el) return
    const ro = new ResizeObserver(() =>
      setBox({ w: el.clientWidth, h: el.clientHeight }),
    )
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // 行数按格子和估算(ceil(Σ格数 / 列数)):跨格块的 flow 空洞会让真实行数**多于**估算
  // (下界),行高按更少行分高、图标略偏大,极端满页矮视口下底部可能溢出被裁——
  // 不模拟 flow(ADR-0021 的取舍),AIHOT 常居页首时空洞极少。
  const usedRows = Math.ceil(cellsUsed(icons) / GRID_COLUMNS)
  // edge 不直接进 style:它经 rowH 驱动 Tile 块(TileFrame,Tile.tsx 私有)的 flex
  // 填充高度,块再被 maxHeight(标称)与 maxWidth min(标称,100%) 双向钳制
  const { rowH } = iconCellGeometry({
    iconScale,
    labelBlock: labelBlockPx(labelVisible, labelSize),
    gapY: gridGapY,
    usedRows,
    trackW: box.w > 0 ? (box.w - (GRID_COLUMNS - 1) * gridGap) / GRID_COLUMNS : 0,
    gridH: box.h,
  })

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
            此页暂无图标 · 右键进入编辑模式,⚙ 里新增
          </div>
        </PageDropArea>
      </section>
    )
  }

  const style: CSSProperties = {
    gridTemplateColumns: `repeat(${GRID_COLUMNS}, minmax(0, 1fr))`,
    // 行 = 图标几何行高(仅实际占用行存在);不再 repeat(8,1fr) 平分画布。
    gridAutoRows: rowH,
    // 自上向下排列:稀疏页剩余空隙沉底,图标簇贴画布顶部(用户要求,原为垂直居中)。
    alignContent: 'start',
    maxWidth: gridWidth,
    // 「布局设置」间距拆分:横向(列)= gridGap,竖向(行)= gridGapY(上限宽,固定画布防溢出)。
    columnGap: gridGap,
    rowGap: gridGapY,
  }

  return (
    <section className="p-2 w-full h-full flex flex-col">
      <h2 className="text-sm font-medium tracking-wide text-white/85 mb-4 text-center">
        {page.name}
        {editing && <CapacityBadge remaining={remaining} />}
      </h2>
      <div ref={gridRef} className="grid flex-1 min-h-0 w-full mx-auto" style={style} role="grid">
        {/* id=页 id 字符串:dnd-kit 把它作为本页 sortable 项的 containerId 写入其 data,
            DashboardPage 的 onDragOver 据 over.data.current.sortable.containerId 判断跨页(issue 07)。 */}
        <SortableContext id={String(page.id)} items={icons.map((i) => i.id)} strategy={rectSortingStrategy}>
          {icons.map((icon) => (
            <IconView key={icon.id} icon={icon} onOpenDetail={onOpenDetail} onOpenGroup={onOpenGroup} />
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
