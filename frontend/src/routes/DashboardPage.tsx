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
import { useAuth } from '../context/AuthContext'
import { useConfig, useMoveIcon } from '../api/config'
import { moveIcon } from '../lib/iconReducer'
import { canFit, DEFAULT_PAGE_CAPACITY } from '../lib/iconCapacity'
import { withDefaults } from '../lib/layoutSettings'
import { EditModeProvider, useEditMode } from '../context/EditModeContext'
import { IconDataProvider } from '../context/IconDataContext'
import { LayoutSettingsProvider } from '../context/LayoutSettingsContext'
import SearchBox from '../components/SearchBox'
import Background from '../components/Background'
import Carousel, { EDGE_DROP_ID } from '../components/Carousel'
import IconGrid from '../components/IconGrid'
import IconView from '../components/Icon'
import StockModal from '../components/StockModal'
import WeatherModal from '../components/WeatherModal'
import ChangelogDrawer from '../components/ChangelogDrawer'
import AddDrawer from '../components/AddDrawer'
import SettingsDrawer from '../components/SettingsDrawer'
import { get } from '../lib/iconTypeRegistry'
import type { Config, Icon, IconTypeId, Page } from '../lib/types'

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
}: {
  page: Page
  icons: Icon[]
  onOpenDetail?: (icon: Icon) => void
}) {
  const pageIcons = useMemo(
    () => icons.filter((i) => i.pageId === page.id),
    [icons, page.id],
  )
  return <IconGrid page={page} icons={pageIcons} onOpenDetail={onOpenDetail} />
}

function Dashboard() {
  const { user, logout } = useAuth()
  const { data } = useConfig()
  const layout = withDefaults(data?.layoutSettings)
  const { editing, toggle } = useEditMode()

  // 详情面板状态集中在此(spec §详情容器:同一时刻只开一个详情)。
  // stock → Modal、changelog → 底部 Drawer、nav 不经此(其详情=新标签打开)。
  const [detail, setDetail] = useState<Icon | null>(null)

  // 新增抽屉开关(issue 09):右上角 "+" 唤起,与编辑模式职责分离。
  const [addDrawerOpen, setAddDrawerOpen] = useState(false)

  // 布局设置抽屉开关:右上角 ⚙ 唤起,三项显示几何随账号持久化、跨设备共享。
  const [settingsOpen, setSettingsOpen] = useState(false)

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
  const qc = useQueryClient()
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
  )

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

  // 编辑态进入时关闭已开的详情与新增抽屉,避免编辑/详情/新增态并存(spec user story 29)。
  useEffect(() => {
    if (editing) {
      setDetail(null)
      setAddDrawerOpen(false)
    }
  }, [editing])

  // 新模型:pages 按 sortOrder 升序,icons 分组进各页。
  const pages = data?.pages ?? []
  const icons = data?.icons ?? []

  // 拖拽幽灵数据源:按 activeIconId 在 icons 里查(icons 在此之后才声明,故派生放这里)。
  const activeIcon =
    activeIconId != null ? icons.find((i) => i.id === activeIconId) ?? null : null

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
  function handleDragOver(e: DragOverEvent) {
    const { active, over } = e
    if (!over) return
    // 边缘 droppable 由 EdgeDropZone 自管计时器翻页,这里不处理其落点
    if (over.id === EDGE_DROP_ID.left || over.id === EDGE_DROP_ID.right) return
    const activeId = Number(active.id)
    const cur = qc.getQueryData<Config>(['config'])
    if (!cur) return
    const dragged = cur.icons.find((i) => i.id === activeId)
    if (!dragged) return

    // 空页落点(07 限制修复):空页只有页级 useDroppable(见 IconGrid.PageDropArea),
    // over.data.current.type==='page',无 sortable.containerId。命中即把图标移入空页位序 0。
    const overData = over.data.current
    if (overData?.type === 'page') {
      const targetPageId = overData.pageId
      if (targetPageId === dragged.pageId) return
      const targetIcons = cur.icons.filter((i) => i.pageId === targetPageId)
      if (!canFit(targetIcons, DEFAULT_PAGE_CAPACITY, dragged.size)) {
        showNotice('目标页已满,无法移入')
        return
      }
      qc.setQueryData<Config>(['config'], (prev) =>
        prev
          ? { ...prev, icons: moveIcon(prev.icons, { id: activeId, toPageId: targetPageId, toIndex: 0 }) }
          : prev,
      )
      return
    }

    // over 所在容器(页)id —— IconGrid 的 SortableContext id=String(page.id)
    const containerId = overData?.sortable?.containerId
    if (containerId == null) return
    const targetPageId = Number(containerId)
    if (Number.isNaN(targetPageId) || targetPageId === dragged.pageId) return // 同页:交给落点提交

    // 跨页容量预校验:目标页当前不含被拖项,canFit 直接判断"已用 + 被拖尺寸 ≤ 容量"
    const targetIcons = cur.icons.filter((i) => i.pageId === targetPageId)
    if (!canFit(targetIcons, DEFAULT_PAGE_CAPACITY, dragged.size)) {
      showNotice('目标页已满,无法移入')
      return
    }
    // 落点 = over 项在目标页(按 sortOrder 升序)中的位序;over 非目标页成员则追加末尾
    const overId = Number(over.id)
    const overIdx = [...targetIcons]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .findIndex((i) => i.id === overId)
    const toIndex = overIdx === -1 ? targetIcons.length : overIdx

    // 乐观更新缓存(无网络):被拖项立即进入目标页 SortableContext,视觉上"跟随光标进入新页"。
    // 最终位置在 onDragEnd 持久化;此处复用与 useMoveIcon 同一的纯 reducer moveIcon,保证语义一致。
    qc.setQueryData<Config>(['config'], (prev) =>
      prev
        ? { ...prev, icons: moveIcon(prev.icons, { id: activeId, toPageId: targetPageId, toIndex }) }
        : prev,
    )
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

    // 跨页:缓存已是最终态,持久化最终页 + 位序
    if (current.pageId !== startIcon.pageId) {
      moveIconMut.mutate({ id: activeId, toPageId: current.pageId, toIndex: current.sortOrder })
      return
    }

    // 同页(06):缓存未在拖拽中改过(视觉由 dnd-kit transform 负责),按 over 落点提交
    if (!over || active.id === over.id) return
    const overId = Number(over.id)
    const overIdx = currentIcons
      .filter((i) => i.pageId === current.pageId)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .findIndex((i) => i.id === overId)
    if (overIdx === -1) return
    moveIconMut.mutate({ id: activeId, toPageId: current.pageId, toIndex: overIdx })
  }
  function handleDragCancel() {
    setActiveIconId(null)
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
    >
      <Background />

      {/* 右键编辑提示条 */}
      {editing && (
        <div className="fixed top-0 inset-x-0 z-50 bg-accent text-white text-center text-sm py-1.5 shadow">
          编辑模式 · 右键退出
        </div>
      )}

      {/* 右上角固定控件:归组进一条玻璃胶囊,统一视觉权重(+/⚙/用户名/登出)。
          容器自身是 glass-panel,内部按钮不再各自带玻璃底,改 hover 轻晕。 */}
      <div className="absolute top-4 right-4 z-30 glass-panel rounded-full flex items-center gap-0.5 pl-1 pr-1 py-1">
        {/* 新增图标入口(issue 09):与编辑模式分离,点开侧抽屉选类型即填即加 */}
        <button
          type="button"
          onClick={() => setAddDrawerOpen(true)}
          aria-label="新增图标"
          className="w-8 h-8 rounded-full text-white/90 hover:bg-white/25 flex items-center justify-center text-lg leading-none transition"
        >
          +
        </button>
        {/* 布局设置入口:整体宽度 / 图标间距 / 图标缩放 */}
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          aria-label="布局设置"
          title="布局设置"
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
      </div>

      {/* 整体半透明面板(简约大气风格):铺满整个视口、100% 遮蔽、四边零留白,
          统一承载搜索框 + 走马灯 + 页签。用 page-panel(轻模糊+轻着色)而非 glass-panel,
          既能看清壁纸、又压住亮度保证图标可读;overflow-hidden 裁住内部滚动;无圆角避免边角露白。 */}
      <LayoutSettingsProvider value={layout}>
      <main className="relative z-10 flex-1 min-h-0 flex flex-col page-panel overflow-hidden">
        {/* 顶部常驻:仅搜索框(时钟已移除)。
            pt-16:搜索框整体下移,与底部 pb-16 对称,让搜索框 + 图标区向视口中部聚拢,
            而非搜索贴顶、图标铺到底边。 */}
        <div className="px-4 pt-16 pb-4">
          <div className="w-full max-w-xl mx-auto">
            <SearchBox />
          </div>
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
                <Carousel
                  labels={pages.map((p) => p.name)}
                  onActiveChange={setActiveIndex}
                >
                  {pages.map((p) => (
                    <PageSlide key={p.id} page={p} icons={icons} onOpenDetail={setDetail} />
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
                  <ChangelogDrawer onClose={() => setDetail(null)} />
                )}
                {/* 拖拽幽灵(06):只读副本跟随光标,原位降级为占位;复用 <Icon overlay> 保持视觉一致。
                    置于 IconDataProvider 内以拿到 quotes/changelog 上下文(React 上下文随 React 树,
                    不随 portal DOM)。dropAnimation=null 让落定即隐藏,避免与乐观重排动画叠加抖动。 */}
                <DragOverlay dropAnimation={null}>
                  {activeIcon && <IconView icon={activeIcon} overlay />}
                </DragOverlay>
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

      {/* 新增抽屉(issue 09):fixed 侧抽屉,新图标落到当前激活页末尾。
          existingTypeIds 用于单例置灰;pageId 取当前激活页(无页则禁用提交)。 */}
      {addDrawerOpen && (
        <AddDrawer
          pageId={activePageId}
          existingTypeIds={existingTypeIds}
          onClose={() => setAddDrawerOpen(false)}
        />
      )}

      {/* 布局设置抽屉(见 CONTEXT.md「布局设置」):三项显示几何随账号持久化、跨设备共享。
          layout 由聚合接口得出(叠加抽屉内乐观预览);抽屉自管 draft/预览/PUT。 */}
      {settingsOpen && (
        <SettingsDrawer layout={layout} onClose={() => setSettingsOpen(false)} />
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
