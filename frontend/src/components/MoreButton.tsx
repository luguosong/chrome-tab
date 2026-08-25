/**
 * 跨格大 tile 标头的「更多」按钮(ADR-0022):详情容器的唯一入口——大 tile 整块
 * 点击无操作,开详情只经此按钮(onOpenDetail 由 Icon 直调下发,编辑模式/overlay
 * 幽灵时为 undefined,按钮不渲染——编辑态无交互元素,同 aihot 条目链接降级哲学)。
 */
export default function MoreButton({
  onClick,
  fontSize,
  title,
}: {
  onClick?: () => void
  /** tileFont 字号档返回的 CSS 值(如 '14px')。 */
  fontSize: string
  /** 悬浮提示(各 tile 的详情语义不同)。 */
  title: string
}) {
  if (!onClick) return null
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="shrink-0 rounded-full bg-white/15 px-2.5 py-1 min-h-8 text-white/70 hover:bg-white/30 hover:text-accent active:bg-white/40 transition-colors focus-visible:outline-2 focus-visible:outline-white/60"
      style={{ fontSize }}
    >
      更多
    </button>
  )
}
