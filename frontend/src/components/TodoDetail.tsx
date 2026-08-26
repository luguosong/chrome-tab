import { useEffect } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { dueLabel, isOverdue, priorityDotClass, type TodoTask } from '../lib/todo'

/**
 * 「待办详情」(CONTEXT.md):单条待办的只读展示容器——滴答备注(上游字段名
 * content)的 markdown 渲染(react-markdown + gfm 表格;默认不产 raw HTML,
 * 无 XSS 面)。两种形态共享 Panel:① Modal 内点条目展开的右侧分栏(TodoModal),
 * ② 图标块/窄窗弹出的二级对话框(TodoDetailModal,z-[70] 叠在待办 Modal 上,
 * 全站首个二级遮罩)。编辑与完成仍在列表侧,详情不带写操作。
 */
export function TodoDetailPanel({ task }: { task: TodoTask }) {
  const label = dueLabel(task.dueDate)
  const overdue = isOverdue(task.dueDate)
  return (
    <div className="flex flex-col min-h-0">
      <div className="flex items-start gap-2">
        <h3 className="min-w-0 flex-1 text-base leading-snug text-white/90 break-words">{task.title}</h3>
        <a
          // webapp 任务路由 #p/{projectId}/tasks/{taskId}
          href={`https://dida365.com/webapp/#p/${task.projectId}/tasks/${task.id}`}
          target="_blank"
          rel="noreferrer"
          title="在滴答清单中打开"
          aria-label="在滴答清单中打开"
          className="shrink-0 min-h-8 w-8 rounded-full bg-white/15 flex items-center justify-center text-white/70 text-sm hover:bg-white/30 hover:text-accent active:bg-white/40 transition-colors focus-visible:outline-2 focus-visible:outline-white/60"
        >
          ↗
        </a>
      </div>
      {(task.priority >= 3 || label) && (
        <div className="mt-1 flex items-center gap-2 text-xs text-white/50">
          {task.priority >= 3 && (
            <span className="flex items-center gap-1.5">
              <span aria-hidden className={'w-1.5 h-1.5 rounded-full ' + priorityDotClass(task.priority)} />
              {task.priority >= 5 ? '高优先级' : '中优先级'}
            </span>
          )}
          {label && <span className={'font-mono ' + (overdue ? 'text-red-300' : '')}>{label}</span>}
        </div>
      )}
      <div className="mt-3 pt-3 border-t border-white/10 min-h-0 overflow-y-auto modal-scroll">
        {/* ?. 防御:类型声明 content: string 只对「新版后端」成立,版本错开窗口期
            (如后端镜像未随前端同批部署)该键缺失,裸 .trim() 会炸整棵 React 树 */}
        {task.content?.trim() ? (
          <div className="md-note">
            <Markdown remarkPlugins={[remarkGfm]}>{task.content}</Markdown>
          </div>
        ) : (
          <div className="py-6 text-center text-sm text-white/40">暂无备注</div>
        )}
      </div>
    </div>
  )
}

/**
 * 二级详情对话框(图标块点收集箱条目 / 窄窗降级):复用全站 Modal 容器语汇
 * (遮罩 fade-in + 面板 pop-in + Esc/点遮罩关闭),标题固定、正文自滚。
 * Esc 只关本层——由渲染方控制父级(待办 Modal)在二级开着时忽略 Esc。
 */
export function TodoDetailModal({ task, onClose }: { task: TodoTask; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="待办详情">
      <div className="absolute inset-0 bg-black/50 animate-fade-in" onClick={onClose} />
      <div className="glass-panel glass-panel-readable relative w-full max-w-lg rounded-3xl p-6 max-h-[80vh] flex flex-col animate-pop-in">
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭"
          className="absolute top-3 right-3 w-8 h-8 rounded-full bg-white/20 text-white/80 hover:bg-white/40 focus-visible:outline-2 focus-visible:outline-white/60 transition-colors flex items-center justify-center"
        >
          ×
        </button>
        <TodoDetailPanel task={task} />
      </div>
    </div>
  )
}
