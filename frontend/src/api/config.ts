import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from './client'
import type { Config, NavLink, StockWatch } from '../lib/types'

/** 配置聚合：首屏一次取齐 nav/stock/setting；mutation 后 invalidate 重拉 */
export function useConfig() {
  return useQuery<Config>({
    queryKey: ['config'],
    queryFn: () => apiFetch<Config>('/api/config'),
  })
}

export function useAddNavLink() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { name: string; url: string }) =>
      apiFetch<NavLink>('/api/nav-links', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['config'] }),
  })
}

export function useDeleteNavLink() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) =>
      apiFetch<void>(`/api/nav-links/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['config'] }),
  })
}

export function useAddStockWatch() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { symbol: string; name: string }) =>
      apiFetch<StockWatch>('/api/stock-watches', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['config'] }),
  })
}

export function useDeleteStockWatch() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) =>
      apiFetch<void>(`/api/stock-watches/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['config'] }),
  })
}
