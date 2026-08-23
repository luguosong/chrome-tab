import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../api/client'
import type { AiHotTopic } from '../lib/aihot'

/**
 * AIHOT 热点取数(单例图标,CONTEXT.md「AI 热点」)。不进 IconDataContext 集中层:
 * 单例无批量红利,且未添加该图标的用户不应发请求(同 changelog 的先例)。
 * 图标 body 与 Modal 各自调用,同 queryKey 天然去重。
 *
 * 后端内存缓存 300s 对齐上游 s-maxage;前端 5min staleTime 防同会话重复请求,
 * 10min 轮询维持网格榜首标题温度——更密只会命中后端同一份缓存。
 */
export function useAiHot() {
  return useQuery<AiHotTopic[] | null>({
    queryKey: ['aihot'],
    queryFn: () => apiFetch<AiHotTopic[] | null>('/api/aihot/hot-topics'),
    staleTime: 5 * 60_000,
    refetchInterval: 10 * 60_000,
    retry: 1,
  })
}
