import type { CSSProperties } from 'react'
import type { Icon, Page } from '../lib/types'
import { GRID_COLUMNS } from '../lib/iconLayout'
import IconView from './Icon'

/**
 * 单页图标网格(见 spec §前端架构 IconGrid)。
 *
 * 6 列 CSS grid + dense 自动流,图标按 size 跨格(small=1×1 / medium=2×2 / large=3×2)。
 * 本阶段静态渲染(无拖拽),拖拽与 SortableContext 是 06 ticket 的范围。
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
  if (icons.length === 0) {
    return (
      <section className="glass-panel rounded-3xl p-6 mx-auto max-w-3xl">
        <h2 className="text-xs uppercase tracking-wider text-white/70 mb-4 text-center">
          {page.name}
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
      </h2>
      <div className="grid gap-3" style={style} role="grid">
        {icons.map((icon) => (
          <IconView key={icon.id} icon={icon} onOpenDetail={onOpenDetail} />
        ))}
      </div>
    </section>
  )
}
