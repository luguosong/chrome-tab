import { type ReactNode, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { registerEscHandler } from '../lib/escStack'

const WIDTHS = {
  sm: 'max-w-sm',
  lg: 'max-w-lg',
  '2xl': 'max-w-2xl',
  '3xl': 'max-w-3xl',
} as const

/**
 * 居中详情 Modal 统一壳(ADR-0031):遮罩点击 / Esc 栈派发(escStack,多层同开
 * 只关最上层)/ 关闭钮 / 玻璃面板几何 / 进出场动画一处持有,并
 * createPortal(document.body) 逃出 .page-panel 的 backdrop-filter 包含块
 * (fixed 后代被钳成锚定 main,TodoIcon 快览卡同款教训)。11 个居中 Modal 消费。
 *
 * 不进壳的两样:padding 三形态(p-6 ×9 / p-5 / Changelog 拆内部区块)走 className;
 * 标题区异质(副行文本 vs 行内操作按钮)留在各 Modal。
 */
export default function ModalShell({
  onClose,
  ariaLabel,
  width = '2xl',
  scroll = true,
  z = 60,
  className = '',
  children,
}: {
  onClose: () => void
  ariaLabel: string
  /** 面板最大宽档;待办 Modal 分栏展开时随 selected 切换。 */
  width?: keyof typeof WIDTHS
  /** true(默认)= max-h-[80vh] + overflow-y-auto + modal-scroll;false 连 max-h 都不加
   * (Stock 内容不满屏、Changelog/待办详情内部自滚),保迁移零视觉变化。 */
  scroll?: boolean
  /** 叠层级;二级对话框(待办详情)传 70。 */
  z?: number
  /** 追加到面板上的类(padding 等);与壳内固定类无同轴冲突。 */
  className?: string
  children: ReactNode
}) {
  // Esc 归属走全局栈:本壳挂载即入栈,卸载出栈,按键只达栈顶。
  // 栈成员资格只在挂载/卸载时变动——onClose 引用(调用方多为内联箭头,随父渲染
  // 更新)经 ref 跟随,不触发重排;否则二级详情开着时父组件一次 re-render 就会把
  // 一级 pop 再 push 到栈顶,Esc 反而先关一级。
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })
  useEffect(() => registerEscHandler(() => onCloseRef.current()), [])

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{ zIndex: z }}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
    >
      {/* 遮罩:点击关闭(fade-in 入场,族内统一) */}
      <div className="absolute inset-0 bg-black/50 animate-fade-in" onClick={onClose} />

      <div
        className={
          `glass-panel glass-panel-readable relative w-full rounded-3xl animate-pop-in ${WIDTHS[width]} ` +
          (scroll ? 'max-h-[80vh] overflow-y-auto modal-scroll ' : '') +
          className
        }
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭"
          className="absolute top-3 right-3 z-10 w-8 h-8 rounded-full bg-white/20 text-white/80 hover:bg-white/40 flex items-center justify-center transition-colors focus-visible:outline-2 focus-visible:outline-white/60"
        >
          ×
        </button>
        {children}
      </div>
    </div>,
    document.body,
  )
}
