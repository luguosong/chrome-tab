import { useState, type DragEvent } from 'react'
import type { Page } from '../lib/types'
import {
  useConfig,
  useCreatePage,
  useDeletePage,
  useRenamePage,
  useReorderPages,
} from '../api/config'
import { ApiError } from '../api/client'
import { useEditMode } from '../context/EditModeContext'
import { useCarousel } from './Carousel'
import ConfirmButton from './ConfirmButton'
import { LensBox } from './LensBox'
import { moveItem } from '../lib/arrayUtil'

/**
 * 常驻页签条(spec §前端架构 PageTabs / issue 08)。
 *
 * 职责:
 *   - 常驻显示各页名,点击切换(走马灯 goTo),高亮当前页
 *   - 页签条超宽时横向滚动(页数无上限)
 *   - 编辑模式下:HTML5 拖拽重排页顺序(调 PATCH /api/pages/reorder);
 *     双击页签重命名(PUT /api/pages/{id});× 删除空页(DELETE,非空页 409 提示);
 *     "+" 新建页(POST /api/pages)
 *
 * 当前页索引与翻页能力来自走马灯上下文(useCarousel 的 {active, goTo});
 * 页数据来自 useConfig;编辑态来自 useEditMode。本组件只做 UI 编排,纯逻辑
 * (moveItem)抽在 lib/arrayUtil 并单测。
 *
 * 拖拽选 HTML5 DnD(非 @dnd-kit):本组件与 06/07 的图标拖拽机制独立,避免与
 * PointerSensor 冲突,且无需提前引入 @dnd-kit。
 */
export default function PageTabs() {
  const { data } = useConfig()
  const pages = data?.pages ?? []
  const { active, goTo } = useCarousel()
  const { editing } = useEditMode()

  const createPage = useCreatePage()
  const renamePage = useRenamePage()
  const deletePage = useDeletePage()
  const reorderPages = useReorderPages()

  // 拖拽重排(HTML5 DnD):拖起来的页 id + 悬停目标页 id
  const [dragId, setDragId] = useState<number | null>(null)
  const [overId, setOverId] = useState<number | null>(null)

  // 重命名:正在编辑的页 id + 草稿
  const [renamingId, setRenamingId] = useState<number | null>(null)
  const [draft, setDraft] = useState('')

  // 新建页内联输入
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')

  // 错误提示(删非空页 409 等);下一次操作前持续显示
  const [error, setError] = useState<string | null>(null)

  function commitReorder(fromId: number, toId: number) {
    const fromIdx = pages.findIndex((p) => p.id === fromId)
    const toIdx = pages.findIndex((p) => p.id === toId)
    if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return
    const ordered = moveItem(pages, fromIdx, toIdx)
    // 重排失败(乐观已回滚)也要走底部错误药丸,与删页同族——否则拖了个寂寞无任何反馈
    reorderPages.mutate(ordered.map((p, i) => ({ id: p.id, sortOrder: i })), {
      onError: (e) => setError(e instanceof ApiError ? e.message : '重排失败'),
    })
    // 让当前查看的页跟随重排:active 原指 pages[active],找到它在新序中的位置并切过去,
    // 避免重排后内容跳到别的页。
    const activeId = pages[active]?.id
    if (activeId != null) {
      const newIdx = ordered.findIndex((p) => p.id === activeId)
      if (newIdx !== -1) goTo(newIdx)
    }
  }

  function onDragStart(e: DragEvent, id: number) {
    setDragId(id)
    e.dataTransfer.effectAllowed = 'move'
  }
  function onDragOver(e: DragEvent, id: number) {
    if (dragId === null || dragId === id) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setOverId(id)
  }
  function onDrop(e: DragEvent, id: number) {
    e.preventDefault()
    if (dragId !== null && dragId !== id) commitReorder(dragId, id)
    setDragId(null)
    setOverId(null)
  }
  function onDragEnd() {
    setDragId(null)
    setOverId(null)
  }

  function startRename(p: Page) {
    setError(null)
    setRenamingId(p.id)
    setDraft(p.name)
  }
  function commitRename() {
    const name = draft.trim()
    // 重命名/新建失败补 onError:输入框已随提交卸载,失败只剩静默,须经错误药丸可见
    if (renamingId !== null && name)
      renamePage.mutate({ id: renamingId, name }, {
        onError: (e) => setError(e instanceof ApiError ? e.message : '重命名失败'),
      })
    setRenamingId(null)
    setDraft('')
  }
  function cancelRename() {
    setRenamingId(null)
    setDraft('')
  }

  function commitCreate() {
    const name = newName.trim()
    if (name)
      createPage.mutate(name, {
        onError: (e) => setError(e instanceof ApiError ? e.message : '新建页失败'),
      })
    setCreating(false)
    setNewName('')
  }
  function cancelCreate() {
    setCreating(false)
    setNewName('')
  }

  function removePage(p: Page) {
    setError(null)
    deletePage.mutate(p.id, {
      onError: (e) => setError(e instanceof ApiError ? e.message : '删除失败'),
    })
  }

  // 容器 L2 折射壳(ADR-0012);w-fit + mx-auto:页签少时居中,
  // max-w-full + overflow-x-auto:多时横向滚动(页数无上限)。
  // 页签项不上玻璃:active = 实心白凸起、其余裸文字(原型 prototype/liquid-glass 裁决)。
  return (
    <div className="mt-5 w-full">
      <LensBox
        radius={21}
        className="flex items-center gap-1 p-1 rounded-full mx-auto w-fit max-w-full overflow-x-auto no-scrollbar"
      >
        {pages.map((p, i) => {
          const isActive = i === active
          const isDragging = dragId === p.id
          const isOver = overId === p.id && dragId !== null && dragId !== p.id
          const isRenaming = renamingId === p.id
          return (
            <div
              key={p.id}
              role="tab"
              aria-selected={isActive}
              // roving tabindex:仅当前页进 tab 序;div+onClick 因内嵌删除按钮不能改 button,
              // 语义化保守到 role/aria + 键盘激活
              tabIndex={isActive ? 0 : -1}
              onKeyDown={(e) => {
                // 焦点在内部控件(删页确认)上时键事件归属其自身,不触发翻页
                if (e.target !== e.currentTarget) return
                if (e.key === 'Enter' || e.key === ' ') goTo(i)
              }}
              draggable={editing && !isRenaming}
              onDragStart={editing ? (e) => onDragStart(e, p.id) : undefined}
              onDragOver={editing ? (e) => onDragOver(e, p.id) : undefined}
              onDrop={editing ? (e) => onDrop(e, p.id) : undefined}
              onDragEnd={editing ? onDragEnd : undefined}
              onDoubleClick={editing ? () => startRename(p) : undefined}
              onClick={() => goTo(i)}
              title={editing ? `${p.name} · 双击重命名 · 拖拽排序` : p.name}
              className={
                'group flex items-center gap-1 px-3 py-2 rounded-full text-sm whitespace-nowrap ' +
                // active:scale-[0.97]:按压反馈(transition 已含 transform)——页面起滚前那一拍,界面先应一声
                'transition select-none active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-white/60 ' +
                // 选中拇指的实心白是 prototype/liquid-glass 定稿裁决:L2 镜头轨上的选中态
                // 刻意区别于 .glass-segment-thumb 的 L1 轨道滑块(玻璃页签上再叠玻璃会糊)
                (isActive
                  ? 'bg-white/75 text-zinc-900 font-medium shadow-sm '
                  : 'text-white/80 hover:text-white ') +
                (editing ? 'cursor-grab active:cursor-grabbing ' : 'cursor-pointer ') +
                (isOver ? 'ring-2 ring-white/70 ' : '') +
                (isDragging ? 'opacity-40 ' : '')
              }
            >
              {isRenaming ? (
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename()
                    else if (e.key === 'Escape') cancelRename()
                  }}
                  onClick={(e) => e.stopPropagation()}
                  onContextMenu={(e) => e.stopPropagation()}
                  className="bg-transparent outline-none w-24 text-white placeholder-white/50 border-b border-white/50 focus:border-white/80"
                />
              ) : (
                <span className="max-w-[10rem] truncate">{p.name}</span>
              )}

              {editing && !isRenaming && (
                // 删页改二次确认(首击武装「确认?」再击执行);编辑模式下常显——
                // 原 group-hover 显形在触屏上无处 hover。span 隔离冒泡:点击/右键不
                // 触发外层 goTo 切页与页面级右键退出编辑。
                <span
                  onClick={(e) => e.stopPropagation()}
                  onContextMenu={(e) => e.stopPropagation()}
                >
                  <ConfirmButton
                    label={`删除页 ${p.name}`}
                    title="删除空页(非空页会被拒绝)"
                    onConfirm={() => removePage(p)}
                  />
                </span>
              )}
            </div>
          )
        })}

        {/* 编辑模式:新建页入口(内联输入) */}
        {editing &&
          (creating ? (
            <input
              autoFocus
              placeholder="新页名"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onBlur={commitCreate}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitCreate()
                else if (e.key === 'Escape') cancelCreate()
              }}
              onContextMenu={(e) => e.stopPropagation()}
              className="px-3 py-1.5 rounded-full text-sm bg-white/20 outline-none focus-visible:border-white/80 w-28 text-white placeholder-white/60 border border-white/40"
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                setError(null)
                setCreating(true)
              }}
              onContextMenu={(e) => e.stopPropagation()}
              title="新建页"
              className="shrink-0 px-3 py-2 rounded-full text-sm text-white/80 hover:text-white flex items-center justify-center focus-visible:outline-2 focus-visible:outline-white/60"
            >
              +
            </button>
          ))}
      </LensBox>

      {/* 错误提示(删非空页 409 等):行内浮层,下一次操作清掉。
          与 DashboardPage 容量提示同族(glass-panel rounded-full + animate-pop-in 入场
          ——玻璃底禁 opacity 动画,同 pop-in 注释),统一提示样式。 */}
      {error && (
        <div className="mt-2 text-center text-xs text-white/90 glass-panel rounded-full py-1 px-3 mx-auto w-fit max-w-full animate-pop-in">
          {error}
        </div>
      )}
    </div>
  )
}
