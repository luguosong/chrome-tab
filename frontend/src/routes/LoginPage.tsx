import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { ApiError } from '../api/client'
import Background from '../components/Background'

export default function LoginPage() {
  const { user, login } = useAuth()
  const nav = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  if (user) return <Navigate to="/" replace />

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      await login(username, password)
      nav('/')
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : '登录失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    // 与 Dashboard 同语言:壁纸背景 + 居中半透明玻璃登录卡。
    // 登录表单天然居中,这里用 glass-panel 卡(非旧版 opaque 白卡)承袭整体玻璃风格。
    // 输入框/CTA 对齐全站 drawer 语汇:输入族 bg-white/20 rounded-lg + ring 焦点,
    // CTA 胶囊 rounded-full(去显式 border,焦点环交由 ring)。
    <div className="relative min-h-screen flex items-center justify-center">
      <Background />
      <main className="glass-panel relative z-10 w-full max-w-sm mx-4 rounded-3xl p-8">
        <h1 className="text-2xl font-semibold text-center text-white/90 mb-5">登录</h1>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="用户名"
            autoComplete="username"
            className="bg-white/20 text-white placeholder-white/50 px-3 py-2 rounded-lg outline-none transition focus:ring-2 focus:ring-accent"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="密码"
            autoComplete="current-password"
            className="bg-white/20 text-white placeholder-white/50 px-3 py-2 rounded-lg outline-none transition focus:ring-2 focus:ring-accent"
          />
          {err && <div className="text-down text-sm text-center">{err}</div>}
          <button
            disabled={busy}
            className="bg-accent text-white py-2.5 rounded-full font-medium transition disabled:opacity-50 hover:bg-accent/90
              active:bg-accent/80 focus-visible:outline-2 focus-visible:outline-white/60"
          >
            {busy ? '登录中…' : '登录'}
          </button>
        </form>
      </main>
    </div>
  )
}
