import { useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  closestCorners,
  pointerWithin,
  rectIntersection,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { useQueryClient } from '@tanstack/react-query'
import { changelogSourceOf } from 'chrome-tab-shared'
import { useAuth } from '../context/AuthContext'
import { useConfig, useMergeIcons, useMoveIcon } from '../api/config'
import { ApiError } from '../api/client'
import { moveIcon } from '../lib/iconReducer'
import { groupMembers, moveIntoGroup, topLevelOf } from '../lib/groupReducer'
import { canFit, DEFAULT_PAGE_CAPACITY } from '../lib/iconCapacity'
import { withDefaults } from '../lib/layoutSettings'
import { GroupGestureContext, useGroupGestureDwell } from '../context/GroupGestureContext'
import { EditModeProvider, useEditMode } from '../context/EditModeContext'
import { IconDataProvider } from '../context/IconDataContext'
import { LayoutSettingsProvider } from '../context/LayoutSettingsContext'
import SearchBox from '../components/SearchBox'
import Background from '../components/Background'
import Clock from '../components/Clock'
import { LensBox } from '../components/LensBox'
import Carousel, { EDGE_DROP_ID } from '../components/Carousel'
import IconGrid from '../components/IconGrid'
import IconView from '../components/Icon'
import GroupOverlay, { isGroupContainerId, parseGroupContainerId } from '../components/GroupOverlay'
import StockModal from '../components/StockModal'
import WeatherModal from '../components/WeatherModal'
import ChangelogDrawer from '../components/ChangelogDrawer'
import ControlDrawer from '../components/ControlDrawer'
import { get } from '../lib/iconTypeRegistry'
import type { Config, Icon, IconTypeId, Page } from '../lib/types'

/** 页板底色 RGB(暗色恒定;与 globals.css 的 .dark .page-panel 同源,改色须两处同步)。 */
const PAGE_PANEL_RGB = '18,18,23'

/**
 * 多尺寸 grid 的碰撞检测自定义 fallback 链(ADR-0003):
 * pointerWithin(指针落在 droppable 内)→ rectIntersection(矩形相交)→ closestCorners。
 * 默认 rectIntersection 在可滚动 + 多尺寸容器中已知异常,故套两层兜底。
 */
const collisionDetection: CollisionDetection = (args) => {
  const pointer = pointerWithin(args)
  // 边缘翻页区(07)优先:光标落在左右 w-12 边缘条内时,让 EdgeDropZone 命中而非其下的
  // 页/图标,保证「拖到边缘持续翻页」不被新增的空页 droppable 或图标遮挡打断
  // (尤其修复空页场景下「穿过空页继续翻」被打断的问题)。
  const edge = pointer.filter(
    (d) => d.id === EDGE_DROP_ID.left || d.id === EDGE_DROP_ID.right,
  )
  if (edge.length > 0) return edge
  if (pointer.length > 0) return pointer
  const rect = rectIntersection(args)
  if (rect.length > 0) return rect
  return closestCorners(args)
}

/**
 * 走马灯每屏的内容:取该页的图标,按 sortOrder 升序,交给 IconGrid 渲染。
 * icons 已在 useConfig 解析时归一化;这里只做分组。
 */
function PageSlide({
  page,
  icons,
  onOpenDetail,
  onOpenGroup,
}: {
  page: Page
  icons: Icon[]
  onOpenDetail?: (icon: Icon) => void
  onOpenGroup?: (icon: Icon) => void
}) {
  // 只取页面顶层行(ADR-0011):组内成员随组图标预览渲染,不独立占格。
  // 成员的 pageId 与组同页,故须按 parentId 排除,否则成员会以 sortable 项重复进网格。
  const pageIcons = useMemo(() => topLevelOf(icons, page.id), [icons, page.id])
  return (
    <IconGrid
      page={page}
      icons={pageIcons}
      onOpenDetail={onOpenDetail}
      onOpenGroup={onOpenGroup}
    />
  )
}

function Dashboard() {
  const { user, logout } = useAuth()
  const { data } = useConfig()
  const layout = withDefaults(data?.layoutSettings)
  const { editing, toggle } = useEditMode()

  // 详情面板状态集中在此(spec §详情容器:同一时刻只开一个详情)。
  // stock → Modal、changelog → 底部 Drawer、nav 不经此(其详情=新标签打开)。
  const [detail, setDetail] = useState<Icon | null>(null)

  // 打开中的分组弹层(票 08):值为组行 id;组行被删(空组不存活)/解散后落空,
  // openGroup 派生为 null → 弹层随组行卸载。开关判定在 onDragEnd(见 handleDragEnd)。
  const [openGroupId, setOpenGroupId] = useState<number | null>(null)

  // 控制抽屉开关(issue 09):右上角 ⚙ 唤起,tab 切换「新增 / 布局」,与编辑模式职责分离。
  const [controlOpen, setControlOpen] = useState(false)

  // 当前激活页索引:Carousel 滚动停稳后向上通知,用于新增抽屉把新图标落到"当前页"。
  const [activeIndex, setActiveIndex] = useState(0)

  // 同页拖拽排序(06):鼠标与触控分流,兼顾「直接拖」与点击/触控滑动翻页共存。
  //   - MouseSensor distance:8 —— 鼠标按下后移动 >8px 立即拖拽(满足查看态「直接拖」的预期);
  //     纯点击(位移 <8px)不触发拖拽,链接/详情照常打开。
  //   - TouchSensor delay:250ms + tolerance:5 —— 触控需静止长按 250ms 才拖拽,让走马灯原生
  //     scroll-snap 的「触控横滑翻页」(即时位移 >5px)在此取消拖拽,不抢走滑动手势。
  //   单用 PointerSensor 的 delay 模式会让鼠标「按下即拖」的位移在 5px 容差内超限而 handleCancel,
  //   导致拖拽无反应——故按输入类型拆成两个 sensor。查看模式与编辑模式均启用拖拽。
  const moveIconMut = useMoveIcon()
  const mergeMut = useMergeIcons()
  const qc = useQueryClient()
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
  )

  // 合并手势 dwell(票 07,ADR-0011 建组手势):计时/反馈状态收在 hook,语义见其 JSDoc。
  const { dwellTargetId, clearDwell, updateDwell } = useGroupGestureDwell()

  // 拖拽中的图标 id:供 DragOverlay 渲染跟随光标的只读副本(spec user story 35 视觉反馈)。
  // onDragStart 置位,onDragEnd/onDragCancel 清空。查看/编辑模式拖拽期间均会置位。
  const [activeIconId, setActiveIconId] = useState<number | null>(null)

  // 拖拽起点聚合快照(07):记录 dragStart 时刻的 ['config'] 缓存。两个用途:
  //   - onDragEnd:与"当前缓存"对比判断是否跨页 + 取最终位置(直接读缓存,不依赖 render 闭包新鲜度)。
  //   - onDragCancel:整份回写,撤销 onDragOver 期间的乐观跨页写入(ESC 取消时缓存不留幻影移动)。
  const dragSnapshotRef = useRef<Config | null>(null)

  // 容量拒绝等短暂提示(07):目标页满时 onDragOver 反复触发,setState 同值 React 会 bail-out,
  // 故不会抖动;计时器在最后一次触发后 1.8s 清掉。
  const [notice, setNotice] = useState<string | null>(null)
  const noticeTimerRef = useRef<number | null>(null)
  function showNotice(msg: string) {
    setNotice(msg)
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current)
    noticeTimerRef.current = window.setTimeout(() => setNotice(null), 1800)
  }

  // ── 长按进入编辑模式(票 07 辅助入口;右键为主)───────────────────────────
  // 指针静止按住 550ms → 进入编辑模式(仅查看态;编辑态长按不退出,退出仍走右键防误触)。
  // 位移 >10px(横滑翻页/拖拽)或在交互控件(button/input/a/对话框)上按下则不触发。
  // 触控场景 TouchSensor 已在 250ms 启动拖拽,长按到点时图标处于拖拽中——编辑模式叠加
  // 拖拽本就是合法状态(编辑模式可拖拽),松手落点照常提交,视觉为 banner+抖动即时出现。
  const LONG_PRESS_MS = 550
  const longPressRef = useRef<{ x: number; y: number; timer: number | null }>({
    x: 0,
    y: 0,
    timer: null,
  })
  function clearLongPress() {
    if (longPressRef.current.timer != null) {
      window.clearTimeout(longPressRef.current.timer)
      longPressRef.current.timer = null
    }
  }

  // 编辑态进入时关闭已开的详情与控制抽屉,避免编辑/详情/新增态并存(spec user story 29)。
  useEffect(() => {
    if (editing) {
      setDetail(null)
      setControlOpen(false)
      clearLongPress()
    }
  }, [editing])

  // 新模型:pages 按 sortOrder 升序,icons 分组进各页。
  const pages = data?.pages ?? []
  const icons = data?.icons ?? []

  // 拖拽幽灵数据源:按 activeIconId 在 icons 里查(icons 在此之后才声明,故派生放这里)。
  const activeIcon =
    activeIconId != null ? icons.find((i) => i.id === activeIconId) ?? null : null

  // 打开中的分组弹层组行(票 08):组行被删(空组不存活/解散)后落空 → 弹层卸载
  const openGroup =
    openGroupId != null
      ? icons.find((i) => i.id === openGroupId && i.type === 'group') ?? null
      : null

  // 已存在的图标类型集合——新增抽屉用此判断单例类型置灰(单例=全局唯一,跨页)。
  const existingTypeIds = useMemo<IconTypeId[]>(
    () => [...new Set(icons.map((i) => i.type))],
    [icons],
  )

  // 当前激活页 id——给新增抽屉决定新图标落到哪页。
  // activeIndex 由 Carousel 滚动停稳时向上通知;但删页/重排(issue 08)后 Carousel 内部
  // 会夹住自身 active,若未触发滚动则此处的 activeIndex 可能短暂越界,故读取时再夹一次。
  const activePageId = pages[Math.min(activeIndex, Math.max(0, pages.length - 1))]?.id

  // 拖拽起终点 + 跨页移动(06 同页排序 / 07 跨页)。
  //
  // 跨页机制(spec user story 31/32,ADR-0003):
  //   - 边缘翻页由 Carousel 内的 EdgeDropZone 自管(拖到左右边缘停留 400ms → goTo(±1))。
  //   - onDragOver 检测 over 的 sortable.containerId 与被拖项当前 pageId 不同 → 把图标乐观移入
  //     目标页(直接写 ['config'] 缓存,不发请求),使其进入目标页 SortableContext,实现"跟随光标
  //     进入新页网格"。目标页满则拒绝并提示(对齐后端 requireCapacity)。
  //   - onDragEnd 持久化:跨页时缓存已是最终态,按被拖项当前 (pageId, sortOrder) 提交;
  //     同页时按 over 落点提交(06 原逻辑)。统一走 useMoveIcon(PATCH /api/icons/move),
  //     其 onSettled invalidate 兜底,服务端权威数据最终校正(失败亦自愈)。
  function handleDragStart(e: DragStartEvent) {
    const id = Number(e.active.id) || null
    setActiveIconId(id)
    // 快照此刻的聚合缓存,供 onDragEnd 比较与 onDragCancel 整份回写
    dragSnapshotRef.current = qc.getQueryData<Config>(['config']) ?? null
  }

  /** onDragOver 各分支共用的乐观搬移:直写 ['config'] 缓存(无网络),moveIcon 与
   *  useMoveIcon 同一纯 reducer,保证乐观态与权威态一致(06/07 既有约定)。 */
  function optimisticMove(id: number, toPageId: number, toIndex: number) {
    qc.setQueryData<Config>(['config'], (prev) =>
      prev ? { ...prev, icons: moveIcon(prev.icons, { id, toPageId, toIndex }) } : prev,
    )
  }
  function handleDragOver(e: DragOverEvent) {
    const { active, over } = e
    if (!over) {
      clearDwell() // 指针拖离所有 droppable:熄灭合并反馈,防「不在目标上却建组」
      return
    }
    // 边缘 droppable 由 EdgeDropZone 自管计时器翻页,这里不处理其落点
    if (over.id === EDGE_DROP_ID.left || over.id === EDGE_DROP_ID.right) {
      clearDwell()
      return
    }
    const activeId = Number(active.id)
    const cur = qc.getQueryData<Config>(['config'])
    if (!cur) return
    const dragged = cur.icons.find((i) => i.id === activeId)
    if (!dragged) return

    // 空页落点(07 限制修复):空页只有页级 useDroppable(见 IconGrid.PageDropArea),
    // over.data.current.type==='page',无 sortable.containerId。命中即把图标移入空页位序 0。
    const overData = over.data.current
    const overIsPage = overData?.type === 'page'
    const overContainer = overData?.sortable?.containerId

    // ── 弹层容器(票 08)────────────────────────────────────────────────
    // over 落在组弹层的 SortableContext 内(id=group-{组id}):
    // - 被拖项是「本次拖拽中被乐观搬出」的组成员(dragStart 快照 parentId=该组且当前
    //   已在顶层)→ 乐观搬回组(MultipleContainers 双向搬移;落组内末尾,松手按 over
    //   位序走组内重排提交或整快照回滚)。快照匹配守卫同时防普通网格图标误入组——
    //   入组走 07 的 dwell 手势——并天然防渲染循环(over 不变不触发)。
    // - 其余 = 组内排序/悬停,不参与页面序列搬移;dwell 目标须网格顶层行,一并熄灭。
    const overGroupId =
      typeof overContainer === 'string' ? parseGroupContainerId(overContainer) : null
    if (overGroupId != null) {
      clearDwell()
      const startParentId =
        dragSnapshotRef.current?.icons.find((i) => i.id === activeId)?.parentId ?? null
      if (dragged.parentId == null && startParentId === overGroupId) {
        qc.setQueryData<Config>(['config'], (prev) =>
          prev
            ? { ...prev, icons: moveIntoGroup(prev.icons, { id: activeId, groupId: overGroupId }) }
            : prev,
        )
      }
      return
    }
    // 合并手势 dwell 计时(仅编辑模式;同起点页判定防跨页 409,见 hook JSDoc)
    const startPageId =
      dragSnapshotRef.current?.icons.find((i) => i.id === activeId)?.pageId ?? dragged.pageId
    updateDwell(dragged, startPageId, Number(over.id), overIsPage, cur.icons)

    // ── 组成员拖出(票 08)────────────────────────────────────────────
    // 被拖项在组内且 over 落在页面网格(图标或空页 droppable):乐观 move-out——
    // moveIcon 清 parentId、canFit 直接判「已用 + 1 ≤ 容量」(每图标 1 格,ADR-0016)、
    // 落 over 位序,图标拖拽中即现身目标页网格。落回弹层
    // 已被上方守卫早退;搬移后 parentId 变 null,后续 onDragOver 走顶层同页早退,
    // 不往复搬移(防渲染循环,#735/#1421)。dwell 已挡成员(hook 判 parentId),不冲突。
    if (dragged.parentId != null) {
      const targetPageId = overIsPage ? overData.pageId : Number(overContainer)
      if (!overIsPage && (overContainer == null || Number.isNaN(targetPageId))) return
      const targetIcons = cur.icons.filter(
        (i) => i.pageId === targetPageId && i.parentId === null,
      )
      if (!canFit(targetIcons, DEFAULT_PAGE_CAPACITY)) {
        showNotice('目标页已满,无法移出')
        return
      }
      const overId = Number(over.id)
      const overIdx = [...targetIcons]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .findIndex((i) => i.id === overId)
      optimisticMove(activeId, targetPageId, overIdx === -1 ? targetIcons.length : overIdx)
      return
    }

    if (overIsPage) {
      const targetPageId = overData.pageId
      if (targetPageId === dragged.pageId) return
      // 容量只计顶层行(cellsUsed 内跳过组内成员,ADR-0011)
      const targetIcons = cur.icons.filter((i) => i.pageId === targetPageId)
      if (!canFit(targetIcons, DEFAULT_PAGE_CAPACITY)) {
        showNotice('目标页已满,无法移入')
        return
      }
      optimisticMove(activeId, targetPageId, 0)
      return
    }

    // over 所在容器(页)id —— IconGrid 的 SortableContext id=String(page.id)
    const containerId = overData?.sortable?.containerId
    if (containerId == null) return
    const targetPageId = Number(containerId)
    if (Number.isNaN(targetPageId) || targetPageId === dragged.pageId) return // 同页:交给落点提交

    // 跨页容量预校验:目标页当前不含被拖项,canFit 直接判断"已用 + 被拖尺寸 ≤ 容量"
    // (cellsUsed 只计顶层行;此处同样只滤顶层行——页上有组时成员混入 sortOrder 序列
    // 会让下方 toIndex 偏移,08 修正 07 遗留)
    const targetIcons = cur.icons.filter(
      (i) => i.pageId === targetPageId && i.parentId === null,
    )
    if (!canFit(targetIcons, DEFAULT_PAGE_CAPACITY)) {
      showNotice('目标页已满,无法移入')
      return
    }
    // 落点 = over 项在目标页顶层序列(按 sortOrder 升序;组内成员不参与页面序列,ADR-0011)
    // 中的位序;over 非目标页成员则追加末尾
    const overId = Number(over.id)
    const overIdx = [...targetIcons]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .findIndex((i) => i.id === overId)
    const toIndex = overIdx === -1 ? targetIcons.length : overIdx

    // 乐观更新缓存(无网络):被拖项立即进入目标页 SortableContext,视觉上"跟随光标进入新页"。
    // 最终位置在 onDragEnd 持久化;此处复用与 useMoveIcon 同一的纯 reducer moveIcon,保证语义一致。
    optimisticMove(activeId, targetPageId, toIndex)
  }
  function handleDragEnd(e: DragEndEvent) {
    setActiveIconId(null)
    const { active, over } = e
    const activeId = Number(active.id)
    const snapshot = dragSnapshotRef.current
    dragSnapshotRef.current = null

    // 直接读缓存取"最终态"(跨页时 onDragOver 已写入),不依赖 render 闭包的新鲜度
    const currentIcons = qc.getQueryData<Config>(['config'])?.icons ?? icons
    const current = currentIcons.find((i) => i.id === activeId)
    const startIcon = snapshot?.icons.find((i) => i.id === activeId) ?? null
    if (!current || !startIcon) return

    // ── 合并手势收尾(票 07):dwell 达标**且指针仍停在目标上**才建组/入组;
    // 达标后又拖离(over ≠ 目标)则熄灭反馈、落回下方排序/移动逻辑。
    // 目标从缓存现取(dwell 期间 over 恒定则 onDragOver 不再触发,缓存稳定)。
    if (dwellTargetId != null) {
      const dwellOver = over != null && Number(over.id) === dwellTargetId
      const target = currentIcons.find((i) => i.id === dwellTargetId) ?? null
      const groupId = target?.type === 'group' ? target.id : null
      clearDwell()
      if (dwellOver && target) {
        if (groupId != null) {
          // 拖 nav 到组上:入组(后端忽略 toIndex、恒落组内末尾)
          moveIconMut.mutate(
            { id: activeId, toPageId: target.pageId, toIndex: 0, parentId: groupId },
            { onError: (err) => showNotice(err instanceof ApiError ? err.message : '加入分组失败') },
          )
        } else {
          // nav 拖到 nav 上:建组(memberIds 有序 = [被拖 A, 悬停目标 B],组行继承 B 位)
          mergeMut.mutate(
            { pageId: target.pageId, memberIds: [activeId, target.id] },
            { onError: (err) => showNotice(err instanceof ApiError ? err.message : '创建分组失败') },
          )
        }
        return
      }
    }

    // ── 分组弹层拖拽收尾(票 08)────────────────────────────────────────
    const overData = over?.data.current
    const overContainer = overData?.sortable?.containerId
    const overOnPageGrid =
      over != null &&
      (overData?.type === 'page' ||
        (typeof overContainer === 'string' && !isGroupContainerId(overContainer)))

    // 拖出后未落在页面网格(over 空 / 落回弹层):整份回写 dragStart 快照,回滚
    // onDragOver 的乐观 move-out、组态还原(对齐 onDragCancel;不持久化,不留幻影)
    if (startIcon.parentId != null && current.parentId == null && !overOnPageGrid) {
      if (snapshot) qc.setQueryData<Config>(['config'], snapshot)
      return
    }

    // 组内重排:起终同组(未拖出)——toIndex = over 项在组内全序列的绝对位序
    // (后端 alreadyInside 分支剔除自身后夹紧插入,镜像见 moveIntoGroup)
    if (current.parentId != null && startIcon.parentId === current.parentId) {
      if (!over || active.id === over.id) return
      const overIdx = groupMembers(currentIcons, current.parentId).findIndex(
        (i) => i.id === Number(over.id),
      )
      if (overIdx === -1) return
      moveIconMut.mutate({
        id: activeId,
        toPageId: current.pageId,
        toIndex: overIdx,
        parentId: current.parentId,
      })
      return
    }

    // 弹层关闭判定放 onDragEnd(票 08):被拖项确已脱离组(落页面网格)才关;
    // 组内重排 / 上方回滚均保持开——拖拽中途绝不卸载弹层(research 结论 5)
    if (
      openGroupId != null &&
      startIcon.parentId === openGroupId &&
      current.parentId == null &&
      overOnPageGrid
    ) {
      setOpenGroupId(null)
    }

    // 跨页:缓存已是最终态,持久化最终页 + 位序
    if (current.pageId !== startIcon.pageId) {
      moveIconMut.mutate({ id: activeId, toPageId: current.pageId, toIndex: current.sortOrder })
      return
    }

    // 同页(06):缓存未在拖拽中改过(视觉由 dnd-kit transform 负责),按 over 落点提交。
    // 落点位序按顶层序列解释(组内成员不参与,ADR-0011)。
    if (!over || active.id === over.id) return
    const overId = Number(over.id)
    const overIdx = topLevelOf(currentIcons, current.pageId).findIndex((i) => i.id === overId)
    if (overIdx === -1) return
    moveIconMut.mutate({ id: activeId, toPageId: current.pageId, toIndex: overIdx })
  }
  function handleDragCancel() {
    setActiveIconId(null)
    clearDwell()
    // 撤销 onDragOver 期间的乐观跨页写入:整份回写 dragStart 快照,缓存不留幻影移动
    if (dragSnapshotRef.current) {
      qc.setQueryData<Config>(['config'], dragSnapshotRef.current)
    }
    dragSnapshotRef.current = null
  }

  return (
    // 固定画布(ADR-0002 / CONTEXT.md「页面」):h-screen + overflow-hidden,
    // 页面内容必须在视口内完整呈现,不产生纵向滚动条(滚轮用于翻页,见 Carousel)。
    <div
      className="h-screen overflow-hidden flex flex-col"
      onContextMenu={(e) => {
        e.preventDefault()
        toggle()
      }}
      onPointerDown={(e) => {
        if (editing || e.button !== 0) return
        // 交互控件上长按不进编辑(按钮/输入/链接/对话框内)
        if (
          e.target instanceof Element &&
          e.target.closest('button,a,input,textarea,select,[role="dialog"]')
        )
          return
        clearLongPress()
        longPressRef.current.x = e.clientX
        longPressRef.current.y = e.clientY
        longPressRef.current.timer = window.setTimeout(toggle, LONG_PRESS_MS)
      }}
      onPointerMove={(e) => {
        const lp = longPressRef.current
        if (lp.timer == null) return
        if (Math.hypot(e.clientX - lp.x, e.clientY - lp.y) > 10) clearLongPress()
      }}
      onPointerUp={clearLongPress}
      onPointerCancel={clearLongPress}
      onPointerLeave={clearLongPress}
    >
      <Background />

      {/* 右键编辑提示条 */}
      {editing && (
        <div className="fixed top-0 inset-x-0 z-50 bg-accent text-white text-center text-sm py-1.5 shadow">
          编辑模式 · 右键退出
        </div>
      )}

      {/* 整体半透明面板(简约大气风格):铺满整个视口、100% 遮蔽、四边零留白,
          统一承载搜索框 + 走马灯 + 页签。用 page-panel(轻模糊+轻着色)而非 glass-panel,
          既能看清壁纸、又压住亮度保证图标可读;overflow-hidden 裁住内部滚动;无圆角避免边角露白。
          「布局设置」·雾化(panelFog)经 inline backgroundColor 覆盖 .dark .page-panel 的
          底色 alpha(RGB 取 PAGE_PANEL_RGB,与 globals.css 的 .dark .page-panel 同源,
          改色须两处同步);blur 8px 属定稿,不随设置。 */}
      <LayoutSettingsProvider value={layout}>
      <main
        className="relative z-10 flex-1 min-h-0 flex flex-col page-panel overflow-hidden"
        style={{ backgroundColor: `rgba(${PAGE_PANEL_RGB},${layout.panelFog / 100})` }}
      >
        {/* 顶部常驻(issue 11):时钟(iOS 锁屏式大字裸排)居左 + 右上胶囊 L2 折射壳,
            下接搜索框 —— 顶行布局按原型 prototype/liquid-glass @3f10ddf 定稿。
            pt-8:与编辑模式提示条(顶部 ~32px)不叠。时钟隐藏(clockVisible)时行内只剩
            右上胶囊,justify 切 end 保持其靠右原位。 */}
        <div className="px-4 pt-8 pb-4">
          <div
            className={
              layout.clockVisible
                ? 'flex items-start justify-between gap-4'
                : 'flex items-start justify-end gap-4'
            }
          >
            {layout.clockVisible && <Clock />}
            {/* 右上控件:归组进 L2 胶囊,统一视觉权重(+/⚙/用户名/登出),hover 轻晕 */}
            <LensBox
              radius={22}
              className="shrink-0 rounded-full flex items-center gap-0.5 pl-1 pr-1 py-1"
            >
              {/* 控制抽屉入口(issue 09):右上角 ⚙ 唤起统一抽屉,tab 切换「新增 / 布局」 */}
              <button
                type="button"
                onClick={() => setControlOpen(true)}
                aria-label="新增与设置"
                title="新增与设置"
                className="w-8 h-8 rounded-full text-white/90 hover:bg-white/25 flex items-center justify-center text-base leading-none transition"
              >
                ⚙
              </button>
              <span className="mx-1 h-4 w-px bg-white/20" />
              <span className="text-sm text-white/85 px-1 select-none">{user?.username}</span>
              <button
                onClick={logout}
                className="px-2.5 py-1 rounded-full text-sm text-white/85 hover:bg-white/25 transition"
              >
                登出
              </button>
            </LensBox>
          </div>
          {/* 搜索栏:宽度(searchBarWidth)= max-width、居中;显隐(searchBarVisible)整行卸载。 */}
          {layout.searchBarVisible && (
            <div className="mt-4 w-full mx-auto" style={{ maxWidth: layout.searchBarWidth }}>
              <SearchBox />
            </div>
          )}
        </div>

        {/* 走马灯:从 useConfig().pages 动态渲染,每页一个 IconGrid。
            DndContext 包裹整条走马灯(issue 06):根传感器 + 碰撞 + onDragEnd;每页 IconGrid
            内自建 SortableContext,每图标 useSortable。所有页经 Carousel 的 scroll-snap 常驻
            挂载(非 display:none),droppable 均有有效 rect,满足 ADR-0003 约束。
            IconDataProvider 在此层包裹,使所有 stock 图标共用一次 useQuotes、
            changelog 图标共用一次 useChangelog(见 context/IconDataContext)。
            详情面板(Modal/Drawer)也在此层渲染:它们消费 useIconData 的 error/refetch。*/}
        <div className="flex-1 min-h-0 px-2 pb-16">
          {pages.length > 0 ? (
            <DndContext
              sensors={sensors}
              collisionDetection={collisionDetection}
              autoScroll={false}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
              onDragCancel={handleDragCancel}
            >
              <IconDataProvider icons={icons}>
              {/* 合并手势 dwell 目标下发(Icon 放大反馈);随 DndContext 生命周期,拖拽结束即清 */}
              <GroupGestureContext.Provider value={dwellTargetId}>
                <Carousel
                  labels={pages.map((p) => p.name)}
                  onActiveChange={setActiveIndex}
                >
                  {pages.map((p) => (
                    <PageSlide
                      key={p.id}
                      page={p}
                      icons={icons}
                      onOpenDetail={setDetail}
                      onOpenGroup={(g) => setOpenGroupId(g.id)}
                    />
                  ))}
                </Carousel>
                {/* 详情面板按 detail 字段渲染(ADR-0001 契约),不按 type 字符串 ——
                    新增复用 modal/drawer 的类型无需改此处。 */}
                {detail && get(detail.type)?.detail === 'modal' &&
                  (detail.type === 'weather' ? (
                    <WeatherModal icon={detail} onClose={() => setDetail(null)} />
                  ) : (
                    <StockModal icon={detail} onClose={() => setDetail(null)} />
                  ))}
                {detail && get(detail.type)?.detail === 'drawer' && (
                  <ChangelogDrawer
                    source={changelogSourceOf(detail.data)}
                    onClose={() => setDetail(null)}
                  />
                )}
                {/* 拖拽幽灵(06):只读副本跟随光标,原位降级为占位;复用 <Icon overlay> 保持视觉一致。
                    置于 IconDataProvider 内以拿到 quotes/weather 上下文(React 上下文随 React 树,
                    不随 portal DOM)。dropAnimation=null 让落定即隐藏,避免与乐观重排动画叠加抖动。 */}
                <DragOverlay dropAnimation={null}>
                  {activeIcon && <IconView icon={activeIcon} overlay />}
                </DragOverlay>
                {/* 分组弹层(票 08):portal 到 body 但调用点在根 DndContext React 子树内
                    (useSortable 注册的硬约束);开关判定在 onDragEnd,拖拽中 ESC 走
                    onDragCancel 回滚(dragging 让位)、弹层保持开 */}
                {openGroup && (
                  <GroupOverlay
                    group={openGroup}
                    dragging={activeIconId != null}
                    onClose={() => setOpenGroupId(null)}
                  />
                )}
              </GroupGestureContext.Provider>
              </IconDataProvider>
            </DndContext>
          ) : (
            <div className="text-white/60 text-sm text-center py-8">加载中…</div>
          )}
        </div>
      </main>
      </LayoutSettingsProvider>

      {/* 容量拒绝等短暂提示(07):底部居中浮层,pointer-events-none 不挡交互 */}
      {notice && (
        <div className="fixed bottom-8 inset-x-0 z-50 flex justify-center pointer-events-none">
          <span className="glass-panel text-white/90 text-sm px-4 py-2 rounded-full shadow-lg">
            {notice}
          </span>
        </div>
      )}

      {/* 控制抽屉(issue 09 + 布局设置):fixed 侧抽屉,tab 切换「新增 / 布局」。
          新增 tab:新图标落到当前激活页末尾,existingTypeIds 用于单例置灰;
          布局 tab:五组显示设置随账号持久化、跨设备共享(draft/预览/PUT 在抽屉内)。 */}
      {controlOpen && (
        <ControlDrawer
          pageId={activePageId}
          existingTypeIds={existingTypeIds}
          layout={layout}
          onClose={() => setControlOpen(false)}
        />
      )}
    </div>
  )
}

export default function DashboardPage() {
  return (
    <EditModeProvider>
      <Dashboard />
    </EditModeProvider>
  )
}
