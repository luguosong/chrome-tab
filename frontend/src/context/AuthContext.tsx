import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Me } from '../lib/types'
import { fetchMe, login as apiLogin, logout as apiLogout } from '../api/auth'

interface AuthCtx {
  user: Me | null
  loading: boolean
  login: (u: string, p: string) => Promise<void>
  logout: () => Promise<void>
}

const Ctx = createContext<AuthCtx>(null!)
export const useAuth = () => useContext(Ctx)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchMe()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false))
  }, [])

  const login = async (u: string, p: string) => {
    setUser(await apiLogin(u, p))
  }
  const logout = async () => {
    await apiLogout()
    setUser(null)
  }

  return <Ctx.Provider value={{ user, loading, login, logout }}>{children}</Ctx.Provider>
}
