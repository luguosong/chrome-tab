import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { ApiError } from '../api/client'

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
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <form onSubmit={submit} className="w-72 flex flex-col gap-3 bg-white p-6 rounded-xl shadow">
        <h1 className="text-2xl text-center mb-2 text-gray-800">登录</h1>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="用户名"
          className="border border-gray-300 p-2 rounded outline-none focus:border-[var(--color-accent)]"
          autoComplete="username"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="密码"
          className="border border-gray-300 p-2 rounded outline-none focus:border-[var(--color-accent)]"
          autoComplete="current-password"
        />
        {err && <div className="text-red-500 text-sm">{err}</div>}
        <button
          disabled={busy}
          className="bg-[var(--color-accent)] text-white p-2 rounded disabled:opacity-50 hover:opacity-90"
        >
          {busy ? '登录中…' : '登录'}
        </button>
      </form>
    </div>
  )
}
