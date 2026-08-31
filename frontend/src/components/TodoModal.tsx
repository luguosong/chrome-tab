import { useEffect, useState } from 'react'
import { ApiError } from '../api/client'
import { useCompleteTodo, useCreateTodo, useTodo } from '../hooks/useTodo'
import { dueLabel, isOverdue, priorityDotClass, type TodoBundle, type TodoTask } from '../lib/todo'
import { TodoDetailModal, TodoDetailPanel } from './TodoDetail'
import DetailModal, { QueryPane } from './DetailModal'

/**
 * 待办详情 Modal(见 CONTEXT.md「待办」,3×2 迭代起为三视图):收集箱 / 当天 / 7 天
 * 三 tab(计数徽标 mono 小字;7 天含当天;收集箱为默认首 tab)。列表 = 点掉按钮(乐观完成)+
 * 标题 + 到期标签(过期红,收集箱无日期不显);高优先级行首色点。点条目就地展开
 * 左右分栏(左列表右「待办详情」,Modal max-w 随之 lg→3xl;再点同条收起、切 tab/
 * 完成当前条收起;窄窗 <640px 分栏放不下,降级弹二级对话框)。底部速记输入:
 * Enter → 滴答清单收集箱,成功即切到收集箱 tab——「速记即入箱」闭环,刚记的条目立见。
 * 失败区分:未配置(400)给出生成口令指引,其余给重试。容器:详情 Modal 骨架
 * (ADR-0040;tab 计数依赖 data,失败/首载不渲染 tab 条——与原版一致;状态机与
 * 速记行交织故 pane 自持,错误/加载块走 QueryPane 零件;二级详情开着时 Esc 只关
 * 二级——escStack 栈顶派发结构保证)。
 */
type TodoTab = keyof TodoBundle
const TABS: { key: TodoTab; label: string }[] = [
  { key: 'inbox', label: '收集箱' },
  { key: 'today', label: '当天' },
  { key: 'week', label: '7 天' },
]

export default function TodoModal({ onClose }: { onClose: () => void }) {
  const { data, error, isError, refetch, isFetching } = useTodo()
  const complete = useCompleteTodo()
  const create = useCreateTodo()
  const [tab, setTab] = useState<TodoTab>('inbox')
  const [draft, setDraft] = useState('')
  /** 分栏选中条目 id(宽屏);再点同条收起。 */
  const [selectedId, setSelectedId] = useState<string | null>(null)
  /** 窄窗降级的二级详情(与图标块入口同一形态)。 */
  const [detail, setDetail] = useState<TodoTask | null>(null)
  const narrow = useNarrow()
  // 「从未取到」(200-null)已在 queryFn 归一为 error(ADR-0049),失败判定只剩 isError
  const failed = isError
  const unconfigured = error instanceof ApiError && error.status === 400

  /** 切 tab 即收起详情:选中项多半不在新列表,保留无意义。 */
  const switchTab = (key: TodoTab) => {
    setTab(key)
    setSelectedId(null)
  }

  /** 点条目:窄窗弹二级详情,宽屏展开/收起分栏。 */
  const openItem = (t: TodoTask) => {
    if (narrow) {
      setDetail(t)
      return
    }
    setSelectedId((p) => (p === t.id ? null : t.id))
  }

  // 分栏开着时窗口拖窄(降级含 resize,不止开详情那一刻):选中条迁移为二级详情。
  // 仅随 narrow 变化触发,选中态经渲染层兜底(find 不到即 null)。
  const tasks = data ? data[tab] : []
  useEffect(() => {
    if (!narrow || !selectedId) return
    const t = tasks.find((x) => x.id === selectedId)
    if (t) setDetail(t)
    setSelectedId(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在窄窗变化沿迁移一次
  }, [narrow])

  const submitDraft = () => {
    const title = draft.trim()
    if (!title || create.isPending) return
    create.mutate(title, { onSuccess: () => switchTab('inbox') })
    setDraft('')
  }

  // 越界兜底:选中条已不在当前视图(完成被勾走等)时不渲染分栏
  const selected = selectedId ? (tasks.find((t) => t.id === selectedId) ?? null) : null

  // tab 条(骨架渲染,含悬空回落):计数徽标依赖 data,失败/首载时给空列——
  // 骨架空列守卫即「无 tab 形态」。失败判定含 isError&&data(后台刷新失败但旧
  // 缓存仍在)——原版 failed 分支不渲染 tab 条,旧计数配错误块是误导
  const tabs = data && !failed
    ? TABS.map(({ key, label }) => ({
        key,
        label: (
          <>
            {label}
            <span className="ml-1.5 font-mono text-xs text-white/45">{data[key].length}</span>
          </>
        ),
      }))
    : []

  const list =
    tasks.length === 0 ? (
      <div className="text-sm text-white/50 py-6 text-center">
        {tab === 'inbox' ? '收集箱是空的,底下速记一条' : '这个窗口没有待办 🎉'}
      </div>
    ) : (
      <ul className="space-y-1">
        {tasks.map((t) => (
          <TodoRow
            key={t.id}
            task={t}
            onComplete={() => {
              if (selectedId === t.id) setSelectedId(null) // 完成当前展示条,详情随之收起
              complete.mutate(t)
            }}
            pending={complete.isPending}
            onOpen={() => openItem(t)}
            selected={selectedId === t.id}
          />
        ))}
      </ul>
    )
  const draftRow = (!failed || !unconfigured) && (
    <div className="mt-4 flex items-center gap-2">
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submitDraft()}
        placeholder={create.isPending ? '存入收集箱…' : '速记一条,回车存入收集箱'}
        className="flex-1 min-w-0 rounded-xl bg-white/10 px-3 py-2 text-sm text-white/90 placeholder:text-white/35 outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
      />
    </div>
  )

  return (
    <>
      <DetailModal
        onClose={onClose}
        ariaLabel="待办"
        title="待办"
        subtitle="滴答清单 · 勾掉即完成,速记存入收集箱"
        refresh={() => void refetch()}
        busy={isFetching}
        width={selected ? '3xl' : 'lg'}
        scroll={false}
        className={
          'p-6 max-h-[80vh] modal-scroll transition-[max-width] duration-300 ' +
          // 分栏时加宽一档、整体滚动让位给左右列各自滚动;列表态纵向滚动
          (selected ? 'overflow-hidden flex flex-col' : 'overflow-y-auto')
        }
        tabs={tabs}
        tab={tab}
        onTabChange={switchTab}
      >
        {complete.isError && <div className="mb-2 text-xs text-red-300">完成失败,任务已恢复,请重试</div>}

        {failed ? (
          unconfigured ? (
            <div className="text-sm text-white/60 py-4 leading-relaxed">
              滴答清单未配置:请在网页版「设置 → 账户与安全 → API 口令」生成口令,写入服务器
              <code className="mx-1 px-1 rounded bg-white/10">.env.prod</code> 的
              <code className="mx-1 px-1 rounded bg-white/10">DIDA365_TOKEN</code> 后重启。
            </div>
          ) : (
            <>
              <QueryPane
                state={{ kind: 'error', message: '待办刷新失败' }}
                onRetry={() => void refetch()}
                retryBusy={isFetching}
              />
              {draftRow}
            </>
          )
        ) : data === undefined ? (
          <>
            <QueryPane state={{ kind: 'loading' }} />
            {draftRow}
          </>
        ) : selected ? (
          // 左右分栏:左列(列表/速记,自滚)| 右「待办详情」(正文自滚)。
          // tab 条由骨架钉在面板顶层不随左列滚——长列表下 tab 常驻(ADR-0040 批 2)。
          <div className="flex-1 min-h-0 flex gap-6">
            <div className="flex-1 min-w-0 flex flex-col overflow-y-auto modal-scroll pr-1">
              {list}
              {draftRow}
            </div>
            <aside className="w-[45%] shrink-0 min-h-0 border-l border-white/10 pl-6">
              <TodoDetailPanel task={selected} />
            </aside>
          </div>
        ) : (
          <>
            {list}
            {draftRow}
          </>
        )}
      </DetailModal>
      {detail && <TodoDetailModal task={detail} onClose={() => setDetail(null)} />}
    </>
  )
}

/** 窄窗(< sm 640px):分栏放不下,点条目降级弹二级详情(TodoDetailModal)。 */
function useNarrow() {
  const [narrow, setNarrow] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(max-width: 639px)').matches
      : false,
  )
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)')
    const on = () => setNarrow(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return narrow
}

/** 单行:点掉按钮(圆形,hover 提亮)+ 标题 + 到期标签(收集箱无日期不显);高优先级行首色点。点行开「待办详情」,选中行常亮。 */
function TodoRow({
  task,
  onComplete,
  pending,
  onOpen,
  selected,
}: {
  task: TodoTask
  onComplete: () => void
  pending: boolean
  onOpen: () => void
  selected: boolean
}) {
  const overdue = isOverdue(task.dueDate)
  const label = dueLabel(task.dueDate)
  return (
    <li
      onClick={onOpen}
      className={
        'group rounded-xl px-3 py-2.5 transition flex items-center gap-3 cursor-pointer ' +
        (selected ? 'bg-white/15' : 'hover:bg-white/10')
      }
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation() // 点掉不触发整行开详情
          onComplete()
        }}
        disabled={pending}
        aria-label={`完成:${task.title}`}
        className="shrink-0 w-5 h-5 rounded-full border border-white/40 hover:border-accent hover:bg-accent/20 disabled:opacity-50 flex items-center justify-center"
      >
        <span className="text-meta text-accent opacity-0 group-hover:opacity-100 transition-opacity">✓</span>
      </button>
      {task.priority >= 3 && (
        <span aria-hidden className={'shrink-0 w-1.5 h-1.5 rounded-full ' + priorityDotClass(task.priority)} />
      )}
      <span className="min-w-0 flex-1 truncate text-sm text-white/90" title={task.title}>
        {task.title}
      </span>
      {label && (
        <span className={'shrink-0 text-meta font-mono ' + (overdue ? 'text-red-300' : 'text-white/50')}>
          {label}
        </span>
      )}
    </li>
  )
}
