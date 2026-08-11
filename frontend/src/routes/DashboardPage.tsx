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
import { get } from '../lib/iconTypeRegistry'
import type { Icon, Page } from '../lib/types'

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

  // 编辑态进入时关闭已开的详情,避免编辑/详情态并存(spec user story 29)。
  useEffect(() => {
    if (editing) setDetail(null)
  }, [editing])

  // 新模型:pages 按 sortOrder 升序,icons 分组进各页。
  const pages = data?.pages ?? []
  const icons = data?.icons ?? []

  return (
    <div
      className="min-h-screen flex flex-col"
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
            <Carousel labels={pages.map((p) => p.name)}>
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
