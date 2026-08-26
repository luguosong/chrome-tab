import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { NewsFeedResponse, NewsSourceId } from 'chrome-tab-shared'
import { apiFetch } from '../api/client'

/**
 * 新闻取数与勾选写回(单例图标「新闻」,CONTEXT.md;数据落库、后端 30min 轮询预取,
 * ADR-0027——前端只读库)。不进 IconDataContext 集中层(同 aihot/todo/video/model
 * 先例):单例无批量红利,未添加该图标的用户不应发请求。节奏:staleTime 5min,窗口
 * 聚焦重拉即天然刷新;Modal 打开时显式 refetch。勾选 = 整份 PUT(spec),新勾源由
 * 后端投递首取,响应即最新 feed(勾选后立即反映)。
 */

const KEYS = {
  feed: ['news-feed'] as const,
}

export function useNewsFeed() {
  return useQuery<NewsFeedResponse>({
    queryKey: KEYS.feed,
    queryFn: () => apiFetch<NewsFeedResponse>('/api/news/feed'),
    staleTime: 5 * 60_000,
    retry: 1,
  })
}

/** 整份替换勾选集;响应为替换后的 feed(新勾源首取由后端尾链异步)。 */
export function useSetNewsSources() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (sources: NewsSourceId[]) =>
      apiFetch<NewsFeedResponse>('/api/news/sources', { method: 'PUT', body: JSON.stringify({ sources }) }),
    onSuccess: async (data) => {
      // 先取消在途 GET 再写缓存,防止先发的旧快照后到覆盖勾选结果(勾选框回弹;同 useTodo 先例)
      await qc.cancelQueries({ queryKey: KEYS.feed })
      qc.setQueryData(KEYS.feed, data)
    },
  })
}
