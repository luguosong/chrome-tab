import { apiFetch } from './client'
import type { Me } from '../lib/types'

export const fetchMe = () => apiFetch<Me>('/api/me')

export const login = (username: string, password: string) =>
  apiFetch<Me>('/api/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })

export const logout = () => apiFetch<void>('/api/logout', { method: 'POST' })
