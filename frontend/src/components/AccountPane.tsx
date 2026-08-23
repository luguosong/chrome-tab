import { useAuth } from '../context/AuthContext'

/**
 * 账号面板:ControlDrawer 的「账号」tab 内容,承接原顶栏的用户信息与登出
 * (顶栏极简化为单个 ⚙ 圆钮后,账号身份的唯一呈现处)。
 *
 * Me 仅含 username,不虚构邮箱/头像字段;头像圈取用户名首字符。
 * 登出后 user 落空,RequireAuth 随即 Navigate 到 /login,抽屉随路由卸载,无需手动关。
 */
export function AccountPane() {
  const { user, logout } = useAuth()
  const initial = [...(user?.username ?? '')][0]?.toUpperCase() ?? '?'

  return (
    <div className="flex flex-col items-center pt-10">
      <div
        aria-hidden
        className="w-16 h-16 rounded-full bg-accent shadow-lg flex items-center justify-center text-2xl font-medium text-white select-none"
      >
        {initial}
      </div>
      <p className="mt-4 text-base text-white/90 break-all">{user?.username}</p>
      <button
        type="button"
        onClick={() => logout()}
        className="mt-8 rounded-full bg-white/10 px-5 py-1.5 text-sm text-white/80 transition
          hover:bg-accent hover:text-white focus-visible:outline-2 focus-visible:outline-white/60"
      >
        登出
      </button>
    </div>
  )
}
