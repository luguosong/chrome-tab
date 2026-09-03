import { useQuery } from '@tanstack/react-query'
import { apiFetch } from './client'

/**
 * 法定休/班标记(CONTEXT.md「节假日」②轨,ADR-0054):后端 ics 上游内存快照的
 * 全量平铺(2013 起 ~500 条),前端自建 YYYY-MM-DD map 消费。字段类型只对同版本
 * 后端成立,渲染侧一律 `?.` 不裸调(2026-08-25 白屏事故口径)。
 */

export interface HolidayDay {
  date: string // YYYY-MM-DD
  kind: 'rest' | 'work'
  name: string
}

export const HOLIDAYS_KEY = ['holidays'] as const

export function useHolidays() {
  return useQuery({
    queryKey: HOLIDAYS_KEY,
    queryFn: () => apiFetch<{ days: HolidayDay[] }>('/api/holidays'),
    staleTime: 24 * 60 * 60_000, // 与后端上游 TTL 同步;数据一年一变
  })
}
