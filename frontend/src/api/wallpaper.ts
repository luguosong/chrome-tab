import { useQuery } from '@tanstack/react-query'
import { apiFetch } from './client'

export interface Wallpaper {
  url: string
  copyright: string
  date: string
}

/** 必应每日壁纸：一天一换，staleTime 给到 1 小时，避免频繁打后端 */
export function useWallpaper() {
  return useQuery<Wallpaper>({
    queryKey: ['wallpaper'],
    queryFn: () => apiFetch<Wallpaper>('/api/wallpaper'),
    staleTime: 60 * 60 * 1000,
    retry: 1,
  })
}
