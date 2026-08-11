import { useMemo } from 'react'
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
import type { Icon, Page } from '../lib/types'

/**
 * 走马灯每屏的内容:取该页的图标,按 sortOrder 升序,交给 IconGrid 渲染。
 * icons 已在 useConfig 解析时归一化;这里只做分组。
 */
function PageSlide({ page, icons }: { page: Page; icons: Icon[] }) {
  const pageIcons = useMemo(
    () => icons.filter((i) => i.pageId === page.id),
    [icons, page.id],
  )
  return <IconGrid page={page} icons={pageIcons} />
}

function Dashboard() {
  const { user, logout } = useAuth()
  const { data } = useConfig()
  useApplyTheme(data?.setting.theme ?? 'system')
  const { editing, toggle } = useEditMode()

  // 新模型:pages 按 sortOrder 升序,icons 分组进各页。
  // expand 阶段(见 issue 01)旧字段 navLinks/stockWatches 仍在,但本页只读 pages/icons。
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
          changelog 图标共用一次 useChangelog(见 context/IconDataContext)。*/}
      <div className="flex-1 px-2 pb-6">
        {pages.length > 0 ? (
          <IconDataProvider icons={icons}>
            <Carousel labels={pages.map((p) => p.name)}>
              {pages.map((p) => (
                <PageSlide key={p.id} page={p} icons={icons} />
              ))}
            </Carousel>
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
