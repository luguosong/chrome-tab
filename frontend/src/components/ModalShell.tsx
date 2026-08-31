import { type ReactNode, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { registerEscHandler } from '../lib/escStack'
import { useExitClose } from '../hooks/useExitClose'

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
 * (fixed 后代被钳成锚定 main,TodoIcon 快览卡同款教训)。直接消费:详情 Modal
 * 骨架(ADR-0040,十家详情 Modal 经它)+ 待办详情二级对话框 + 倒计时编辑弹层。
 *
 * 退场(对称路径:从哪进就从哪出,2026-08-31):关闭不立即上调 onClose,先播
 * pop-out + 遮罩 fade-out、EXIT_MS 后真关闭——父组件 state 不动,面板内容冻结
 * 播完再卸载;消费方零改动。退场窗口封冻三件套:面板 inert(输入无效)、遮罩
 * pointer-events-none(点击穿页)、Esc 栈提前出栈(Esc 达下层)。已知取舍:
 * 退场窗口内(~200ms)经入口重开会被完成中的关闭吞掉,下一轮点击即正常。
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
  // 栈成员资格只在挂载/卸载/closing 时变动——onClose 引用(调用方多为内联箭头,
  // 随父渲染更新)经 useExitClose 的 ref 跟随 + requestClose 引用稳定,注册不随
  // 父渲染重排;否则二级详情开着时父组件一次 re-render 就会把一级 pop 再 push
  // 到栈顶,Esc 反而先关一级。

  // ── 退场接线(协议单点 hooks/useExitClose;封冻语义见其注释)────────────
  const { closing, requestClose } = useExitClose(onClose)
  // closing 即提前出栈:退场中 modality 已转移,Esc 应达下层(双 Esc 关两层
  // 不被退场窗口吞掉)。注销函数幂等(escStack findIndex 失配 no-op),closing
  // 提前出栈与卸载 cleanup 双调安全。
  const offEscRef = useRef<(() => void) | null>(null)
  useEffect(() => {
    const off = registerEscHandler(requestClose)
    offEscRef.current = off
    return off
  }, [requestClose])
  useEffect(() => {
    if (closing) offEscRef.current?.()
  }, [closing])
  // 退场中封冻面板输入(inert:pointer/keyboard/focus 一并):窗口内的面板动作
  // (点行开二级对话框、连点成员)执行了也会被随后的卸载拆除,宁可无效勿被拆。
  const panelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (panelRef.current) panelRef.current.inert = closing
  }, [closing])

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{ zIndex: z }}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
    >
      {/* 遮罩:点击关闭;入场 fade-in / 退场 fade-out(纯色可动 opacity,渐隐在此)
          + pointer-events-none(dismiss 已开始,点击穿页到达背后内容) */}
      <div
        className={`absolute inset-0 bg-black/50 ${
          closing ? 'animate-fade-out pointer-events-none' : 'animate-fade-in'
        }`}
        onClick={requestClose}
      />

      <div
        ref={panelRef}
        className={
          `glass-panel glass-panel-readable relative w-full rounded-3xl ${closing ? 'animate-pop-out' : 'animate-pop-in'} ${WIDTHS[width]} ` +
          (scroll ? 'max-h-[80vh] overflow-y-auto modal-scroll ' : '') +
          className
        }
      >
        <button
          type="button"
          onClick={requestClose}
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
