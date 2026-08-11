import { useAuth } from '../context/AuthContext'
import { useConfig } from '../api/config'
import { useApplyTheme } from '../hooks/useTheme'
import Clock from '../components/Clock'
import SearchBox from '../components/SearchBox'
import ThemeToggle from '../components/ThemeToggle'
import NavTileGroup from '../components/tiles/NavTileGroup'
import StockTile from '../components/tiles/StockTile'
import ChangelogTile from '../components/tiles/ChangelogTile'

export default function DashboardPage() {
  const { user, logout } = useAuth()
  const { data } = useConfig()
  useApplyTheme(data?.setting.theme ?? 'system')
  return (
    <div className="min-h-screen p-8 bg-gray-50 dark:bg-zinc-950">
      <div className="flex flex-wrap items-end justify-between gap-6 mb-6">
        <Clock />
        <SearchBox />
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <span className="text-sm text-gray-600 dark:text-zinc-300">{user?.username}</span>
          <button
            onClick={logout}
            className="border border-gray-300 dark:border-zinc-700 text-gray-700 dark:text-zinc-200 px-3 py-1 rounded hover:bg-gray-100 dark:hover:bg-zinc-800"
          >
            登出
          </button>
        </div>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <NavTileGroup />
        <StockTile />
        <ChangelogTile />
      </div>
    </div>
  )
}
