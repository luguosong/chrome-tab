import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useConfig } from '../api/config'
import { useApplyTheme } from '../hooks/useTheme'
import { EditModeProvider, useEditMode } from '../context/EditModeContext'
import { IconDataProvider } from '../context/IconDataContext'
import Clock from '../components/Clock'
import SearchBox from '../components/SearchBox'
import ThemeToggle from '../components/ThemeToggle'
import Background from '../components/Background'
import Carousel from '../components/Carousel'
import IconGrid from '../components/IconGrid'
import StockModal from '../components/StockModal'
import ChangelogDrawer from '../components/ChangelogDrawer'
import AddDrawer from '../components/AddDrawer'
import { get } from '../lib/iconTypeRegistry'
import type { Icon, IconTypeId, Page } from '../lib/types'

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
  useApplyTheme(data?.setting.theme ?? 'system')
  const { editing, toggle } = useEditMode()

  // 详情面板状态集中在此(spec §详情容器:同一时刻只开一个详情)。
  // stock → Modal、changelog → 底部 Drawer、nav 不经此(其详情=新标签打开)。
  const [detail, setDetail] = useState<Icon | null>(null)

  // 新增抽屉开关(issue 09):右上角 "+" 唤起,与编辑模式职责分离。
  const [addDrawerOpen, setAddDrawerOpen] = useState(false)

  // 当前激活页索引:Carousel 滚动停稳后向上通知,用于新增抽屉把新图标落到"当前页"。
  const [activeIndex, setActiveIndex] = useState(0)

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

  // 已存在的图标类型集合——新增抽屉用此判断单例类型置灰(单例=全局唯一,跨页)。
  const existingTypeIds = useMemo<IconTypeId[]>(
    () => [...new Set(icons.map((i) => i.type))],
    [icons],
  )

  // 当前激活页 id——给新增抽屉决定新图标落到哪页。
  // activeIndex 由 Carousel 滚动停稳时向上通知;但删页/重排(issue 08)后 Carousel 内部
  // 会夹住自身 active,若未触发滚动则此处的 activeIndex 可能短暂越界,故读取时再夹一次。
  const activePageId = pages[Math.min(activeIndex, Math.max(0, pages.length - 1))]?.id

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

      {/* 右上角固定控件 */}
      <div className="absolute top-4 right-4 z-30 flex items-center gap-3">
        <ThemeToggle />
        {/* 新增图标入口(issue 09):与编辑模式分离,点开侧抽屉选类型即填即加 */}
        <button
          type="button"
          onClick={() => setAddDrawerOpen(true)}
          aria-label="新增图标"
          className="glass-panel text-white/90 w-8 h-8 rounded-full hover:bg-white/40 flex items-center justify-center text-lg leading-none"
        >
          +
        </button>
        <span className="text-sm text-white/90 drop-shadow">{user?.username}</span>
        <button
          onClick={logout}
          className="glass-panel text-white/90 px-3 py-1 rounded hover:bg-white/40"
        >
          登出
        </button>
      </div>

      {/* 顶部常驻:时钟 + 搜索框 */}
      <div className="flex flex-col items-center pt-16 pb-6 px-4">
        <Clock />
        <div className="mt-6 w-full max-w-xl">
          <SearchBox />
        </div>
      </div>

      {/* 走马灯:从 useConfig().pages 动态渲染,每页一个 IconGrid。
          IconDataProvider 在此层包裹,使所有 stock 图标共用一次 useQuotes、
          changelog 图标共用一次 useChangelog(见 context/IconDataContext)。
          详情面板(Modal/Drawer)也在此层渲染:它们消费 useIconData 的 error/refetch。*/}
      <div className="flex-1 px-2 pb-6">
        {pages.length > 0 ? (
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
            {detail && get(detail.type)?.detail === 'modal' && (
              <StockModal icon={detail} onClose={() => setDetail(null)} />
            )}
            {detail && get(detail.type)?.detail === 'drawer' && (
              <ChangelogDrawer onClose={() => setDetail(null)} />
            )}
          </IconDataProvider>
        ) : (
          <div className="text-white/60 text-sm text-center py-8">加载中…</div>
        )}
      </div>

      {/* 新增抽屉(issue 09):fixed 侧抽屉,新图标落到当前激活页末尾。
          existingTypeIds 用于单例置灰;pageId 取当前激活页(无页则禁用提交)。 */}
      {addDrawerOpen && (
        <AddDrawer
          pageId={activePageId}
          existingTypeIds={existingTypeIds}
          onClose={() => setAddDrawerOpen(false)}
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
