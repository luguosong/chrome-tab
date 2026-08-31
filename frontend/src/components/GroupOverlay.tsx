import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { SortableContext, rectSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useConfig, useDeleteIcon, useUpdateIconData } from '../api/config'
import { useEditMode } from '../context/EditModeContext'
import { useExitClose } from '../hooks/useExitClose'
import { get } from '../lib/iconTypeRegistry'
import ConfirmButton from './ConfirmButton'
import { EditForm } from './Icon'
import { groupMembers, groupPageCount, groupPageSlice } from '../lib/groupReducer'
import { groupContainerId } from '../lib/iconDrag'
import { extractString, navIconSrc } from '../lib/iconData'
import type { Icon } from '../lib/types'

/**
 * 分组弹层(票 08,ADR-0011 / CONTEXT.md「分组」):点组图标打开的 iOS 文件夹式弹层。
 *
 * 结构硬约束(见 research/dnd-overlay-drag-out @ d0a6ea1,9 条坑逐一核对):
 * - **portal 在根 DndContext 的 React 子树内**(调用点在 DashboardPage 的 DndContext
 *   里)——portal 挪 DOM 不挪 React 树,useSortable 照常向根 context 注册;调用点
 *   挪出子树则静默失效(dnd-kit issue #58)。
 * - **暗化 backdrop 常态 `pointer-events: none`**,内容区(面板)单独恢复交互——
 *   否则拖出弹层后 over 永远落不到背后的页面网格;「点外部关闭」由此走 document
 *   捕获 phase 的 pointerdown(落点不在面板内即关,左键),点击穿透到背后网格。
 * - 弹层内是拖拽体系**又一个 SortableContext**(id=`group-{组id}`,与页 id 纯数字串
 *   区分),跨容器搬移三段式在 DashboardPage 的 onDragStart/onDragOver/onDragEnd;
 *   弹层显隐判定也在 onDragEnd(落页面网格才关),拖拽中途绝不卸载。
 *
 * 交互:滚轮翻组内页(原生非被动监听吃掉事件,不透传;≤9 个成员也吃)与页点指示器;
 * 点组名行内改名(任意模式,CONTEXT.md「分组改名除外」;清空回落「新建分组」);
 * 查看态点子图标 = 新标签打开后关闭;子图标两种模式均可拖组内排序(对齐页面网格
 * 06「查看/编辑均启用拖拽」先例;移出分组仍仅编辑模式,见 DashboardPage 守卫),
 * 编辑态另有 ✎ 编辑配置 + × 删除。
 */
export default function GroupOverlay({
  group,
  dragging,
  onClose,
}: {
  group: Icon
  /** 根 DndContext 有激活拖拽:ESC 让位 dnd-kit 的 onDragCancel(回滚、弹层保持开)。 */
  dragging: boolean
  onClose: () => void
}) {
  const { data } = useConfig()
  const members = useMemo(
    () => groupMembers(data?.icons ?? [], group.id),
    [data?.icons, group.id],
  )
  const [page, setPage] = useState(0)
  const pageCount = groupPageCount(members.length)
  // 删成员后页数收缩:显示页夹到末页(page 原值留给滚轮单调更新,不回拨 state)
  const cur = Math.min(page, Math.max(0, pageCount - 1))
  const slice = groupPageSlice(members, cur)

  const panelRef = useRef<HTMLDivElement>(null)

  // ── 退场接线(协议单点 hooks/useExitClose)─────────────────────────────
  // 退场只挂 Esc 与查看态点子图标两路(交互已完成/意图明确,延迟卸载安全);
  // 「点外部」保持同步关闭,见下方该 effect 的注释。
  const { closing, requestClose } = useExitClose(onClose)
  // 退场中封冻面板输入(inert):连点成员不再重复 window.open 新标签
  useEffect(() => {
    if (panelRef.current) panelRef.current.inert = closing
  }, [closing])

  // ── 行内改名(任意模式)──────────────────────────────────────────────────
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState('')
  const renameMut = useUpdateIconData()
  const name = extractString(group.data, 'name') || '新建分组'
  function commitRename() {
    setRenaming(false)
    const next = draft.trim() || '新建分组' // 清空回落默认(CONTEXT.md「分组」)
    if (next === name) return
    renameMut.mutate({ id: group.id, data: { name: next } })
  }

  // ── 点外部关闭(左键)——同步关,不走退场 ────────────────────────────────
  // backdrop 是 pointer-events:none,点击穿透到背后网格;关闭判定在捕获 phase:
  // 先于网格图标的 click 触发关弹层,穿透点击的默认行为(开网站/开组)照常完成。
  // 退场动画(2026-08-31)刻意不挂这条路:关闭是穿透交互的搭车副作用而非直接
  // 意图,延迟卸载会让「点 B 组」撞上 A 的退场定时器(B 在同一 fiber 上冻成
  // 退场终态再被误关),网格拖拽起手也会在拖拽中途被定时器卸载弹层——违反
  // 「拖拽中途绝不卸载」硬约束。让位即同步,与退场前的行为一致。
  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (e.button !== 0) return // 右键留给编辑模式切换,不关弹层
      if (panelRef.current?.contains(e.target as Node)) return
      onClose()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [onClose])

  // ── ESC:拖拽中取消拖拽,非拖拽关闭弹层(票 08)────────────────────────
  // dnd-kit 6.x 只有 KeyboardSensor 监听 Escape,Mouse/Touch 拖拽按 ESC 默认无反应
  // (core 源码 AbstractPointerSensor 仅绑 pointercancel/pointermove/pointerup)。
  // 拖拽中 ESC → dispatch 合成 pointercancel 命中传感器在 document 上的监听 →
  // dnd-kit 正常走 onDragCancel(既有整快照回滚、弹层保持开);handleCancel 只
  // preventDefault + detach,不读事件字段,合成事件无 pointerId 也可用。
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (dragging) {
        document.dispatchEvent(
          new PointerEvent('pointercancel', { cancelable: true }),
        )
      } else {
        requestClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [dragging, requestClose])

  // ── 滚轮翻组内页(吃掉事件,不透传)─────────────────────────────────────
  // React onWheel 是被动监听,preventDefault 无效——挂原生非被动监听。portal 在
  // document.body,走马灯挂在自身元素上的 wheel 监听本就收不到这里的冒泡;preventDefault
  // + stopPropagation 再兜底,≤9 个成员(单页)同样吃掉(票 08 硬性要求)。
  useEffect(() => {
    const el = panelRef.current
    if (!el) return
    function onWheel(e: WheelEvent) {
      e.preventDefault()
      e.stopPropagation()
      setPage((p) => {
        const max = Math.max(0, groupPageCount(members.length) - 1)
        return Math.max(0, Math.min(p + (e.deltaY > 0 ? 1 : -1), max))
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [members.length])

  return createPortal(
    <div className="fixed inset-0 z-40 flex items-center justify-center">
      {/* 暗化背景:常态 pointer-events:none(票 08 硬约束);浓度与其余浮层遮罩统一 /50。
          入场/退场动画与其余 L1 弹层同语汇(fade-in/pop-in 纯 CSS,不碰 dnd 拖拽量测)。 */}
      <div
        className={`absolute inset-0 bg-black/50 pointer-events-none ${
          closing ? 'animate-fade-out' : 'animate-fade-in'
        }`}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-label={`分组 ${name}`}
        className={`relative glass-panel pointer-events-auto rounded-3xl p-5 w-[min(92vw,380px)] shadow-2xl ${
          closing ? 'animate-pop-out' : 'animate-pop-in'
        }`}
      >
        {/* 组名:点开行内改名(Enter/失焦提交,ESC 只取消改名——input 的
            stopPropagation 挡住下方 document keydown,不连带关弹层) */}
        {renaming ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename()
              else if (e.key === 'Escape') {
                e.stopPropagation()
                setRenaming(false)
              }
            }}
            aria-label="分组名称"
            className="block mx-auto w-52 px-2 py-0.5 rounded-full text-center text-sm font-medium tracking-wide bg-white/20 text-white placeholder-white/50 outline-none focus:ring-2 focus:ring-accent"
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              setDraft(name)
              setRenaming(true)
            }}
            title="重命名分组"
            className="block mx-auto max-w-full truncate px-3 py-0.5 rounded-full text-center text-sm font-medium tracking-wide text-white/90 hover:bg-white/15 transition"
          >
            {name}
          </button>
        )}

        {/* 组内成员第 cur 页(3×3 展示切片,ADR-0011:分页非实体)。
            id=group-{组id} 让 DashboardPage 的 onDragOver 判容器归属(与页 id 区分)。 */}
        <SortableContext
          id={groupContainerId(group.id)}
          items={slice.map((m) => m.id)}
          strategy={rectSortingStrategy}
        >
          <div className="grid grid-cols-3 gap-x-4 gap-y-4 py-3 min-h-[132px]">
            {slice.map((m) => (
              <MemberTile key={m.id} member={m} onClose={requestClose} />
            ))}
          </div>
        </SortableContext>

        {members.length === 0 ? (
          <p className="pb-3 text-center text-white/50 text-sm">
            此分组暂无图标
          </p>
        ) : (
          pageCount > 1 && (
            <div className="flex justify-center gap-1.5 pb-1" aria-hidden>
              {Array.from({ length: pageCount }, (_, i) => (
                <span
                  key={i}
                  className={
                    'h-1.5 w-1.5 rounded-full transition ' +
                    (i === cur ? 'bg-white/90' : 'bg-white/30')
                  }
                />
              ))}
            </div>
          )
        )}
      </div>
    </div>,
    document.body,
  )
}

/**
 * 弹层内单个子图标(组成员恒为 nav,后端把关)。查看态 = div role=link,点击/中键/
 * Enter 显式 window.open 新标签打开后关弹层(见下方查看态分支注释);编辑态 =
 * ✎ 编辑配置(EditForm popover,复用网格 Icon.tsx 同款——编辑图标配置是编辑模式
 * 通用能力,CONTEXT.md「编辑模式」)+ × 删除(DELETE,乐观移除;组因此变空由服务端
 * 删组行 → openGroup 落空 → 弹层随 Dashboard 卸载)。组内排序两种模式均可拖
 * (对齐网格 Icon.tsx「查看/编辑均启用」:listeners 恒注入,点击/拖拽分流靠传感器
 * 激活策略——鼠标 8px、触控长按 250ms)。
 */
function MemberTile({ member, onClose }: { member: Icon; onClose: () => void }) {
  const { editing } = useEditMode()
  const del = useDeleteIcon()
  const editIcon = useUpdateIconData()
  // 组成员恒 nav(editor=name+url+icon 非空),仍按注册表驱动与网格同构
  const editor = get(member.type)?.editor ?? []
  const [editOpen, setEditOpen] = useState(false)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: member.id,
  })

  const name = extractString(member.data, 'name')
  const url = member.type === 'nav' ? extractString(member.data, 'url') : ''
  // 覆盖 > 派生,与网格/组预览同一口径(navIconSrc)
  const src = member.type === 'nav' ? navIconSrc(member.data) : ''

  const body = (
    <>
      {/* squircle 玻璃底板 + 居中 favicon。固定迷你尺寸、不随图标缩放(ICON_SCALE):
          组内是统一迷你渲染(CONTEXT.md「分组」)。img 须 draggable={false}:原生 drag
          判定会先派 pointercancel 掐断 dnd-kit 指针流(慢速拖拽必中,dragstart 上
          preventDefault 为时已晚),须从判定层禁掉。 */}
      <span className="glass-soft rounded-[24%] flex items-center justify-center w-[60px] h-[60px] mx-auto">
        {src && (
          <img
            src={src}
            alt=""
            draggable={false}
            className="w-10 h-10 rounded-[22%]"
            referrerPolicy="no-referrer"
          />
        )}
      </span>
      {name && (
        <span className="text-xs text-white/90 max-w-full truncate text-center">{name}</span>
      )}
    </>
  )

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    ...(isDragging ? { opacity: 0.4 } : null),
  }

  if (!editing) {
    // 查看态用 div role=link 而非 <a href>:拖拽松手的 click 会被 dnd-kit 在 document
    // capture 层 stopPropagation(只停传播、不阻 defaultAction),<a> 的原生激活仍会当前
    // 标签导航走——无 href 即无原生 defaultAction,「新标签打开」由显式 window.open
    // 承接(中键 onAuxClick、键盘 Enter 同路),与 CONTEXT.md 组内语义一致。
    return (
      <div
        ref={setNodeRef}
        style={style}
        role="link"
        tabIndex={0}
        aria-label={name || '打开链接'}
        onClick={() => {
          window.open(url, '_blank', 'noopener')
          onClose()
        }}
        onAuxClick={(e) => {
          if (e.button === 1) {
            window.open(url, '_blank', 'noopener')
            onClose()
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            window.open(url, '_blank', 'noopener')
            onClose()
          }
        }}
        draggable={false}
        {...listeners}
        className="flex flex-col items-center gap-1.5 rounded-2xl p-1.5 cursor-pointer hover:bg-white/10 active:scale-95 transition focus-visible:outline-2 focus-visible:outline-white/60"
      >
        {body}
      </div>
    )
  }
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="relative flex flex-col items-center gap-1.5 rounded-2xl p-1.5 editing-jiggle cursor-grab active:cursor-grabbing select-none focus-visible:outline-2 focus-visible:outline-white/60"
    >
      {body}
      {/* 角标:✎ 编辑配置 + × 删除(对齐网格 Icon.tsx EditActions)。删除走 ConfirmButton
          二次确认(首击武装「确认?」再击执行),红系武装态自表意,误触即删由此兜住。
          外层 span 持有 onPointerDown/onClick/onContextMenu stopPropagation 防误启拖拽
          与误触发右键切编辑(同网格 EditActions 角标;共享组件不收事件 props,守卫上提一层)。 */}
      <span
        className="absolute -top-1.5 -right-1.5 z-10 flex items-center gap-1"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.stopPropagation()}
      >
        {editor.length > 0 && (
          <button
            type="button"
            disabled={del.isPending || editIcon.isPending}
            onClick={() => setEditOpen(!editOpen)}
            onContextMenu={(e) => e.stopPropagation()}
            className="glass-panel w-8 h-8 rounded-full text-meta leading-none text-white/90 flex items-center justify-center hover:bg-white/40 active:bg-white/40 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-white/60"
            title="编辑"
          >
            ✎
          </button>
        )}
        <ConfirmButton
          label={name ? `删除 ${name}` : '删除图标'}
          title="删除"
          onConfirm={() => del.mutate(member.id)}
        />
      </span>
      {/* 编辑配置 popover(Icon.tsx 导出的同款):保存走 PATCH /api/icons/{id},
          遮罩 z-[60] 盖住本弹层(z-40),点弹层任意处取消 */}
      {editor.length > 0 && editOpen && (
        <EditForm
          fields={editor}
          icon={member}
          busy={del.isPending || editIcon.isPending}
          onCancel={() => setEditOpen(false)}
          onSave={(data) => {
            editIcon.mutate({ id: member.id, data })
            setEditOpen(false)
          }}
        />
      )}
    </div>
  )
}
