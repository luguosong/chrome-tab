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
  const [showPwd, setShowPwd] = useState(false)
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
            required
            className="bg-white/20 text-white placeholder-white/50 px-3 py-2 rounded-lg outline-none transition focus:ring-2 focus:ring-accent"
          />
          <div className="relative">
            <input
              type={showPwd ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="密码"
              autoComplete="current-password"
              required
              className="w-full bg-white/20 text-white placeholder-white/50 px-3 py-2 pr-10 rounded-lg outline-none transition focus:ring-2 focus:ring-accent"
            />
            <button
              type="button"
              onClick={() => setShowPwd((v) => !v)}
              aria-label={showPwd ? '隐藏密码' : '显示密码'}
              aria-pressed={showPwd}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-white/50 hover:text-white/90 transition focus-visible:outline-2 focus-visible:outline-white/60"
            >
              {showPwd ? (
                // 睁眼(MIT Tabler icons)
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10 12a2 2 0 1 0 4 0a2 2 0 0 0 -4 0" />
                  <path d="M21 12c-2.4 4-5.4 6-9 6c-3.6 0-6.6-2-9-6c2.4-4 5.4-6 9-6c3.6 0 6.6 2 9 6" />
                </svg>
              ) : (
                // 闭眼(MIT Tabler icons)
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 3l18 18" />
                  <path d="M10.585 10.587a2 2 0 0 0 2.829 2.828" />
                  <path d="M18.364 18.364c-1.481 1.126-3.391 1.885-5.864 1.885c-3.6 0-6.6-2-9-6a19 19 0 0 1 3.198-4.094" />
                  <path d="M9.88 5.09a9.6 9.6 0 0 1 1.62-.49c3.6 0 6.6 2 9 6a19 19 0 0 1 -.564 1.05" />
                </svg>
              )}
            </button>
          </div>
          {err && <div className="text-danger text-sm text-center">{err}</div>}
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
