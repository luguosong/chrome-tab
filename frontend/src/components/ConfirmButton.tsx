import { useEffect, useState } from 'react'

/**
 * 破坏性操作二次确认(2026-08-25 由 VideoModal 私有组件提为共享,iOS 26 五态补全):
 * 首击武装变「确认?」(3s 自动解除),再击执行——不引弹窗,编辑态密集网格里的
 * 误触即永久删除由此兜住(Icon 删除 ×、PageTabs 删页、GroupOverlay 删成员、
 * VideoModal 删分类/删博主同范式)。
 *
 * 命中区:before 伪元素四周外扩 6px(视觉 24px 圆 → 36px 热区),密集布局里
 * 不挤压相邻元素;armed 态 min-w 放弃、px 撑开成红胶囊。
 */
export default function ConfirmButton({
  label,
  title,
  onConfirm,
  disabled = false,
}: {
  label: string
  title: string
  onConfirm: () => void
  /** 请求在途时由调用方禁用:armed 态点击后不自解,靠此门控防连击重复触发(Icon 删除)。 */
  disabled?: boolean
}) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 3_000)
    return () => clearTimeout(t)
  }, [armed])
  return (
    <button
      type="button"
      aria-label={label}
      title={title}
      disabled={disabled}
      onClick={() => (armed ? onConfirm() : setArmed(true))}
      className={
        'relative shrink-0 h-6 min-w-6 rounded-full text-xs leading-none transition-colors ' +
        'before:absolute before:-inset-1.5 before:content-[""] ' +
        'focus-visible:outline-2 focus-visible:outline-white/60 ' +
        'disabled:opacity-50 ' +
        (armed
          ? 'px-2 bg-red-400/40 text-red-200'
          : 'px-0 text-white/50 hover:bg-red-400/25 hover:text-red-300')
      }
    >
      {armed ? '确认?' : '✕'}
    </button>
  )
}
