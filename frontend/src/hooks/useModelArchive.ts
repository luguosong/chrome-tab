import { useQuery } from '@tanstack/react-query'
import type { ModelArchiveResponse } from 'chrome-tab-shared'
import { apiFetch } from '../api/client'

/**
 * 模型追踪档案取数(单例图标「模型追踪」,CONTEXT.md;数据 = 后端全局持久档案 +
 * 6h 轮询,ADR-0025——前端只读库)。不进 IconDataContext 集中层:单例无批量红利,
 * 且未添加该图标的用户不应发请求(同 aihot/todo/video 先例)。图标 body 与 Modal
 * 同 queryKey 天然去重;staleTime 5min + 窗口聚焦重拉即产品天然刷新节奏(video 同款)。
 */
export function useModelArchive() {
  return useQuery<ModelArchiveResponse>({
    queryKey: ['model-archive'],
    queryFn: () => apiFetch<ModelArchiveResponse>('/api/model-tracking/archive'),
    staleTime: 5 * 60_000,
    retry: 1,
  })
}
