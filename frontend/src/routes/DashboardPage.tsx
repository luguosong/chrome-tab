import { useAuth } from '../context/AuthContext'
import NavTileGroup from '../components/tiles/NavTileGroup'
import StockTile from '../components/tiles/StockTile'

export default function DashboardPage() {
  const { user, logout } = useAuth()
  return (
    <div className="min-h-screen p-8 bg-gray-50">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl text-gray-800">已登录：{user?.username}</h1>
        <button
          onClick={logout}
          className="border border-gray-300 px-3 py-1 rounded hover:bg-gray-100"
        >
          登出
        </button>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <NavTileGroup />
        <StockTile />
      </div>
    </div>
  )
}
