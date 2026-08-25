import { useAuth } from '../context/AuthContext'

/**
 * 账号面板:ControlDrawer 的「账号」tab 内容,承接原顶栏的用户信息与登出
 * (顶栏极简化为单个 ⚙ 圆钮后,账号身份的唯一呈现处)。
 *
 * Me 仅含 username,不虚构邮箱/头像字段;头像圈取用户名首字符。
 * 头像投影收敛为体系轻投影(对齐 .glass-segment-thumb 暗色值,inset 高光保留);
 * 登出走次级胶囊档(bg-white/20 hover 白 30,accent hover 留给主 CTA)。
 * 登出后 user 落空,RequireAuth 随即 Navigate 到 /login,抽屉随路由卸载,无需手动关。
 */
export function AccountPane() {
  const { user, logout } = useAuth()
  const initial = [...(user?.username ?? '')][0]?.toUpperCase() ?? '?'

  return (
    <div className="flex flex-col items-center pt-10">
      <div
        aria-hidden
        className="w-16 h-16 rounded-full bg-accent flex items-center justify-center text-2xl font-medium text-white select-none shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_1px_6px_rgba(0,0,0,0.28)]"
      >
        {initial}
      </div>
      <p className="mt-4 text-base text-white/90 break-all">{user?.username}</p>
      <button
        type="button"
        onClick={() => logout()}
        className="mt-8 rounded-full bg-white/20 px-5 py-1.5 text-sm text-white/80 transition
          hover:bg-white/30 hover:text-white focus-visible:outline-2 focus-visible:outline-white/60"
      >
        登出
      </button>
    </div>
  )
}
