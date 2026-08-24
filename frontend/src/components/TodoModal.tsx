import { useEffect, useState } from 'react'
import { ApiError } from '../api/client'
import { useCompleteTodo, useCreateTodo, useTodo } from '../hooks/useTodo'
import { dueLabel, isOverdue, type TodoTask } from '../lib/todo'

/**
 * 待办详情 Modal(见 CONTEXT.md「待办」,与天气/AI 热点同范式的详情容器)。
 * 完整今日待办列表(后端按到期升序):行 = 点掉按钮(乐观完成)+ 标题 + 到期
 * 标签(过期红);高优先级行首色点。底部速记输入:Enter 提交 → 滴答收集箱
 * (无日期,不进今日列表)。失败区分:未配置(400)给出生成口令指引,其余给重试。
 * 容器:fixed 遮罩 + 居中玻璃面板;Esc / 点遮罩关闭(同 AiHotModal)。
 */
export default function TodoModal({ onClose }: { onClose: () => void }) {
  const { data, error, isError, refetch, isFetching } = useTodo()
  const complete = useCompleteTodo()
  const create = useCreateTodo()
  const [draft, setDraft] = useState('')
  // 失败 = 网络错(isError)或后端从未取到(data===null,HTTP 200);
  // data===undefined 是首次加载中,不算失败(区别于 null,AiHotModal 同款)。
  const failed = isError || data === null
  const unconfigured = error instanceof ApiError && error.status === 400
  const tasks = data ?? []

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const submitDraft = () => {
    const title = draft.trim()
    if (!title || create.isPending) return
    create.mutate(title, { onSuccess: () => setDraft('') })
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="今日待办"
    >
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      <div className="glass-panel glass-panel-readable relative w-full max-w-lg rounded-3xl p-6 max-h-[80vh] overflow-y-auto">
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭"
          className="absolute top-3 right-3 w-8 h-8 rounded-full bg-white/20 text-white/80 hover:bg-white/40 flex items-center justify-center"
        >
          ×
        </button>

        <div className="mb-4">
          <div className="text-lg text-white/90">待办</div>
          <div className="text-xs text-white/50">今日 + 过期 · 滴答清单,速记存入收集箱</div>
        </div>

        {complete.isError && (
          <div className="mb-2 text-xs text-red-300">完成失败,任务已恢复,请重试</div>
        )}

        {failed ? (
          unconfigured ? (
            <div className="text-sm text-white/60 py-4 leading-relaxed">
              滴答清单未配置:请在网页版「设置 → 账户与安全 → API 口令」生成口令,写入服务器
              <code className="mx-1 px-1 rounded bg-white/10">.env.prod</code> 的
              <code className="mx-1 px-1 rounded bg-white/10">DIDA365_TOKEN</code> 后重启。
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <span className="text-sm text-white/60">待办刷新失败</span>
              <button
                type="button"
                onClick={() => void refetch()}
                disabled={isFetching}
                className="border border-white/30 text-white/80 rounded-md px-2 py-0.5 text-xs hover:border-accent hover:text-accent disabled:opacity-50"
              >
                重试
              </button>
            </div>
          )
        ) : data === undefined ? (
          <div className="text-xs text-white/40 py-6 text-center">加载中…</div>
        ) : tasks.length === 0 ? (
          <div className="text-sm text-white/50 py-6 text-center">今日无事 🎉</div>
        ) : (
          <ul className="space-y-1">
            {tasks.map((t) => (
              <TodoRow key={t.id} task={t} onComplete={() => complete.mutate(t)} pending={complete.isPending} />
            ))}
          </ul>
        )}

        {failed && !unconfigured ? null : (
          <div className="mt-4 flex items-center gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submitDraft()}
              placeholder={create.isPending ? '存入收集箱…' : '速记一条,回车存入收集箱'}
              disabled={unconfigured}
              className="flex-1 min-w-0 rounded-xl bg-white/10 px-3 py-2 text-sm text-white/90 placeholder:text-white/35 outline-none focus:ring-1 focus:ring-accent/60 disabled:opacity-50"
            />
          </div>
        )}
      </div>
    </div>
  )
}

/** 单行:点掉按钮(圆形,hover 提亮)+ 标题 + 到期标签;高优先级行首色点。 */
function TodoRow({ task, onComplete, pending }: { task: TodoTask; onComplete: () => void; pending: boolean }) {
  const overdue = isOverdue(task.dueDate)
  const label = dueLabel(task.dueDate)
  return (
    <li className="group rounded-xl px-3 py-2.5 hover:bg-white/10 transition flex items-center gap-3">
      <button
        type="button"
        onClick={onComplete}
        disabled={pending}
        aria-label={`完成:${task.title}`}
        className="shrink-0 w-5 h-5 rounded-full border border-white/40 hover:border-accent hover:bg-accent/20 disabled:opacity-50 flex items-center justify-center"
      >
        <span className="text-[10px] text-accent opacity-0 group-hover:opacity-100 transition-opacity">✓</span>
      </button>
      {task.priority >= 3 && (
        <span
          aria-hidden
          className={'shrink-0 w-1.5 h-1.5 rounded-full ' + (task.priority >= 5 ? 'bg-red-400' : 'bg-amber-300')}
        />
      )}
      <span className="min-w-0 flex-1 truncate text-sm text-white/90" title={task.title}>
        {task.title}
      </span>
      {label && (
        <span className={'shrink-0 text-[11px] font-mono ' + (overdue ? 'text-red-300' : 'text-white/50')}>
          {label}
        </span>
      )}
    </li>
  )
}
