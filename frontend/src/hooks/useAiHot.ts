import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../api/client'
import type { AiHotModelPick, AiHotTopic } from '../lib/aihot'

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

/**
 * 模型精选取数(CONTEXT.md「模型精选」,Modal 第二 tab;分类与窗口在后端硬编码)。
 * queryKey 挂 ['aihot'] 下与热点榜同族不同键,互不失效。精选更新节奏低(上游每天
 * 几次到几十次),轮询同热点 10min 足够;仅 Modal 打开该 tab 才挂载组件、才发请求。
 */
export function useAiHotModelPicks() {
  return useQuery<AiHotModelPick[] | null>({
    queryKey: ['aihot', 'model-picks'],
    queryFn: () => apiFetch<AiHotModelPick[] | null>('/api/aihot/model-picks'),
    staleTime: 5 * 60_000,
    refetchInterval: 10 * 60_000,
    retry: 1,
  })
}
