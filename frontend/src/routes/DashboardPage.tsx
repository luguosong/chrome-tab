import { useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { useQueryClient } from '@tanstack/react-query'
import { useConfig, useMergeIcons, useMoveIcon } from '../api/config'
import { ApiError } from '../api/client'
import { moveIcon } from '../lib/iconReducer'
import { moveIntoGroup, topLevelOf } from '../lib/groupReducer'
import {
  collisionDetection,
  dragEndDecision,
  dragOverDecision,
  parseOver,
} from '../lib/iconDrag'
import { withDefaults } from '../lib/layoutSettings'
import { GroupGestureContext, useGroupGestureDwell } from '../context/GroupGestureContext'
import { EditModeProvider, useEditMode } from '../context/EditModeContext'
import { IconDataProvider } from '../context/IconDataContext'
import { LayoutSettingsProvider } from '../context/LayoutSettingsContext'
import SearchBox from '../components/SearchBox'
import Background from '../components/Background'
import Clock from '../components/Clock'
import { LensBox } from '../components/LensBox'
import Carousel from '../components/Carousel'
import IconGrid from '../components/IconGrid'
import IconView from '../components/Icon'
import { ICON_TYPE_UI } from '../components/iconTypeUi'
import GroupOverlay from '../components/GroupOverlay'
import ControlDrawer from '../components/ControlDrawer'
import type { Config, Icon, IconTypeId, Page } from '../lib/types'

/** 页板底色 RGB(暗色恒定;与 globals.css 的 .dark .page-panel 同源,改色须两处同步)。 */
const PAGE_PANEL_RGB = '18,18,23'

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
  const { data, isError, refetch } = useConfig()
  const layout = withDefaults(data?.layoutSettings)
  const { editing, toggle } = useEditMode()

  // 详情面板状态集中在此(spec §详情容器:同一时刻只开一个详情)。
  // UI adapter 声明可选详情 renderer;nav/group 无详情,不进入此状态。
  const [detail, setDetail] = useState<Icon | null>(null)
  const DetailView = detail ? ICON_TYPE_UI[detail.type].detail : undefined

  // 打开中的分组弹层(票 08):值为组行 id;组行被删(空组不存活)/解散后落空,
  // openGroup 派生为 null → 弹层随组行卸载。开关判定在 onDragEnd(见 handleDragEnd)。
  const [openGroupId, setOpenGroupId] = useState<number | null>(null)

  // 控制抽屉开关(issue 09):右上角 ⚙ 唤起,tab 切换「新增 / 布局 / 账号」,与编辑模式职责分离。
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

  // 拖拽起终点 + 跨页移动(06 同页排序 / 07 跨页)。策略(容量门、落点位序、
  // dwell 建组/入组判定、弹层开关判定)单点于 lib/iconDrag 的纯决策函数
  // (CONTEXT.md「拖拽编排」);本组件只做接线:组装 ctx → 执行 Action。
  //
  // 跨页机制(spec user story 31/32,ADR-0003):
  //   - 边缘翻页由 Carousel 内的 EdgeDropZone 自管(拖到左右边缘停留 400ms → goTo(±1))。
  //   - onDragOver 检测落点与被拖项当前页不同 → 把图标乐观移入目标页(直接写 ['config']
  //     缓存,不发请求),使其进入目标页 SortableContext,实现"跟随光标进入新页网格"。
  //     目标页满则拒绝并提示(对齐后端 requireCapacity)。
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
    // 直接读缓存(不依赖 render 闭包新鲜度);缓存未就绪直接不处理(镜像提取源早退)
    const currentIcons = qc.getQueryData<Config>(['config'])?.icons
    if (currentIcons == null) return
    const actions = dragOverDecision({
      icons: currentIcons,
      snapshotIcons: dragSnapshotRef.current?.icons ?? null,
      editing,
      over: parseOver(e.over),
      draggedId: Number(e.active.id),
    })
    for (const action of actions) {
      switch (action.type) {
        case 'clearDwell':
          clearDwell()
          break
        case 'updateDwell':
          // 合并手势 dwell 计时(仅编辑模式;同起点页判定防跨页 409,见 hook JSDoc)
          updateDwell(
            action.dragged,
            action.startPageId,
            action.overId,
            action.overIsPage,
            currentIcons,
          )
          break
        case 'optimisticMove':
          optimisticMove(action.id, action.toPageId, action.toIndex)
          break
        case 'optimisticIntoGroup':
          qc.setQueryData<Config>(['config'], (prev) =>
            prev
              ? { ...prev, icons: moveIntoGroup(prev.icons, { id: action.id, groupId: action.groupId }) }
              : prev,
          )
          break
        case 'notice':
          showNotice(action.message)
          break
      }
    }
  }
  function handleDragEnd(e: DragEndEvent) {
    setActiveIconId(null)
    const snapshot = dragSnapshotRef.current
    dragSnapshotRef.current = null
    // 直接读缓存取"最终态"(跨页时 onDragOver 已写入),不依赖 render 闭包的新鲜度
    const currentIcons = qc.getQueryData<Config>(['config'])?.icons ?? icons
    const actions = dragEndDecision({
      icons: currentIcons,
      snapshotIcons: snapshot?.icons ?? null,
      over: parseOver(e.over),
      draggedId: Number(e.active.id),
      dwellTargetId,
      openGroupId,
    })
    for (const action of actions) {
      switch (action.type) {
        case 'clearDwell':
          clearDwell()
          break
        case 'commitIntoGroup':
          // 拖 nav 到组上:入组(后端忽略 toIndex、恒落组内末尾)
          moveIconMut.mutate(
            { id: action.id, toPageId: action.toPageId, toIndex: 0, parentId: action.groupId },
            { onError: (err) => showNotice(err instanceof ApiError ? err.message : '加入分组失败') },
          )
          break
        case 'commitMergeGroup':
          // nav 拖到 nav 上:建组(memberIds 有序 = [被拖 A, 悬停目标 B],组行继承 B 位)
          mergeMut.mutate(
            { pageId: action.pageId, memberIds: action.memberIds },
            { onError: (err) => showNotice(err instanceof ApiError ? err.message : '创建分组失败') },
          )
          break
        case 'rollback':
          // 整份回写 dragStart 快照,撤销 onDragOver 期间的乐观写入(不留幻影)
          if (snapshot) qc.setQueryData<Config>(['config'], snapshot)
          break
        case 'closeOverlay':
          setOpenGroupId(null)
          break
        case 'commitMove':
          moveIconMut.mutate(
            action.parentId != null
              ? { id: action.id, toPageId: action.toPageId, toIndex: action.toIndex, parentId: action.parentId }
              : { id: action.id, toPageId: action.toPageId, toIndex: action.toIndex },
          )
          break
      }
    }
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

      {/* 编辑模式提示条:玻璃胶囊 + 「完成」显式退出钮(右键/Esc 仍可用,但退出不再
          依赖不可发现的右键语义——2026-08-27 测试报告 #5) */}
      {editing && (
        <div className="fixed top-0 inset-x-0 z-50 flex justify-center py-2 animate-drop-in">
          <span className="glass-panel inline-flex items-center gap-3 rounded-full py-1.5 pl-4 pr-1.5 text-sm">
            <span className="text-accent">编辑模式</span>
            <button
              type="button"
              onClick={toggle}
              className="rounded-full bg-accent/90 hover:bg-accent active:bg-accent/75 px-3.5 py-1 text-xs text-white transition focus-visible:outline-2 focus-visible:outline-white/60"
            >
              完成
            </button>
          </span>
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
        {/* 顶部常驻(issue 11):右上胶囊 L2 折射壳 + 下接搜索框,布局按原型
            prototype/liquid-glass @3f10ddf 定稿。pt-8:与编辑模式提示条(顶部 ~32px)
            不叠。时钟 absolute 出流居左(left-4/top-8 复刻原 px-4/pt-8 起点):高度
            不再推挤中轴搜索框,两者独立;clockVisible 只控挂载,justify 恒 end。 */}
        <div className="relative px-4 pt-8 pb-4">
          {layout.clockVisible && (
            <div className="absolute left-4 top-8 z-10">
              <Clock />
            </div>
          )}
          <div className="flex items-start justify-end gap-4">
            {/* 右上控件:极简为单个 ⚙ 圆钮(L2 折射壳退化为 40px 正圆);
                用户信息与登出移入控制抽屉「账号」tab */}
            <LensBox radius={20} className="shrink-0 rounded-full p-1">
              {/* 控制抽屉入口(issue 09):右上角 ⚙ 唤起统一抽屉,tab 切换「新增 / 布局 / 账号」 */}
              <button
                type="button"
                onClick={() => setControlOpen(true)}
                aria-label="设置"
                title="设置"
                className="w-8 h-8 rounded-full text-white/90 hover:bg-white/25 active:bg-white/35 flex items-center justify-center text-base leading-none transition focus-visible:outline-2 focus-visible:outline-white/60 focus-visible:outline-offset-2"
              >
                ⚙
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
                {detail && DetailView && (
                  <DetailView icon={detail} onClose={() => setDetail(null)} />
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
          ) : isError ? (
            // 配置拉取失败:区分于加载态,给重试入口(refetch 重发聚合查询,不整页刷新)。
            // 重试按钮按次级胶囊语汇:bg-white/20 hover:bg-white/30 + 统一焦点环。
            <div className="text-white/60 text-sm text-center py-8 flex flex-col items-center gap-2">
              <span>加载失败</span>
              <button
                type="button"
                onClick={() => refetch()}
                className="rounded-full bg-white/20 hover:bg-white/30 active:bg-white/40 px-4 py-1.5 text-white/90 focus-visible:outline-2 focus-visible:outline-white/60"
              >
                重试
              </button>
            </div>
          ) : (
            <div className="text-white/60 text-sm text-center py-8">加载中…</div>
          )}
        </div>
      </main>
      </LayoutSettingsProvider>

      {/* 容量拒绝等短暂提示(07):底部居中浮层,pointer-events-none 不挡交互 */}
      {notice && (
        <div className="fixed bottom-8 inset-x-0 z-50 flex justify-center pointer-events-none">
          {/* animate-pop-in 入场;shadow-lg 删——glass-panel 的 unlayered box-shadow
              恒胜 Tailwind layered 工具类,该类本就无效(项目已知 CSS 层叠特性) */}
          <span className="glass-panel animate-pop-in text-white/90 text-sm px-4 py-2 rounded-full">
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
          onEnterEdit={() => {
            setControlOpen(false)
            if (!editing) toggle()
          }}
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
