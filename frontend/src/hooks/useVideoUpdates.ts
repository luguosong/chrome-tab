import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { VideoBlogger, VideoCategoriesResponse, VideoCategory, VideoFeedItem } from 'chrome-tab-shared'
import { apiFetch } from '../api/client'

/**
 * 视频更新取数与写回(单例图标「视频更新」,CONTEXT.md;数据落库、后端 1h 轮询预取,
 * ADR-0023——前端只读库)。不进 IconDataContext 集中层:单例无批量红利,且未添加该
 * 图标的用户不应发请求(同 aihot/todo 先例)。图标 body 与 Modal 各自调用,同 queryKey
 * 天然去重。写操作(添加/归类/删除博主、分类 CRUD)宽 invalidate 三个键——博主数与
 * tab 归属跨端点耦合,宽失效比精确失效便宜。
 */

const KEYS = {
  feed: ['video-feed'] as const,
  categories: ['video-categories'] as const,
  bloggers: ['video-bloggers'] as const,
}

/** 混合时间流(published_at 倒序,全量 ≤ 每博主 50 条;分类过滤在前端)。
 *  节奏(spec):staleTime 5min,无常驻轮询——新标签页的窗口聚焦重拉(React Query
 *  默认 refetchOnWindowFocus)即产品天然刷新时机,Modal 打开时另行显式 refetch。 */
export function useVideoFeed() {
  return useQuery<VideoFeedItem[]>({
    queryKey: KEYS.feed,
    queryFn: () => apiFetch<VideoFeedItem[]>('/api/video-updates/videos'),
    staleTime: 5 * 60_000,
    retry: 1,
  })
}

/** 分类列表 + 未分类计数(tab 显隐:未分类桶空则不显示该 tab)。 */
export function useVideoCategories() {
  return useQuery<VideoCategoriesResponse>({
    queryKey: KEYS.categories,
    queryFn: () => apiFetch<VideoCategoriesResponse>('/api/video-updates/categories'),
    staleTime: 60_000,
    retry: 1,
  })
}

/** 管理用博主列表(status='failing' 标红「取数失败」)。 */
export function useVideoBloggers() {
  return useQuery<VideoBlogger[]>({
    queryKey: KEYS.bloggers,
    queryFn: () => apiFetch<VideoBlogger[]>('/api/video-updates/bloggers'),
    staleTime: 60_000,
    retry: 1,
  })
}

function useInvalidateVideo() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: KEYS.feed })
    void qc.invalidateQueries({ queryKey: KEYS.categories })
    void qc.invalidateQueries({ queryKey: KEYS.bloggers })
  }
}

/** 添加博主:同步解析元信息(响应即博主行),视频历史由后端尾链异步首取(延迟容忍 1h)。 */
export function useAddVideoBlogger() {
  const invalidate = useInvalidateVideo()
  return useMutation({
    mutationFn: (url: string) =>
      apiFetch<VideoBlogger>('/api/video-updates/bloggers', { method: 'POST', body: JSON.stringify({ url }) }),
    onSuccess: invalidate,
  })
}

/** 博主改分类(null = 未分类)。 */
export function useSetVideoBloggerCategory() {
  const invalidate = useInvalidateVideo()
  return useMutation({
    mutationFn: ({ id, categoryId }: { id: number; categoryId: number | null }) =>
      apiFetch(`/api/video-updates/bloggers/${id}`, { method: 'PUT', body: JSON.stringify({ categoryId }) }),
    onSuccess: invalidate,
  })
}

/** 删博主(视频级联删;重加即重新首取 50 条历史,无损操作)。 */
export function useDeleteVideoBlogger() {
  const invalidate = useInvalidateVideo()
  return useMutation({
    mutationFn: (id: number) => apiFetch(`/api/video-updates/bloggers/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  })
}

export function useCreateVideoCategory() {
  const invalidate = useInvalidateVideo()
  return useMutation({
    mutationFn: (name: string) =>
      apiFetch<VideoCategory>('/api/video-updates/categories', { method: 'POST', body: JSON.stringify({ name }) }),
    onSuccess: invalidate,
  })
}

export function useRenameVideoCategory() {
  const invalidate = useInvalidateVideo()
  return useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) =>
      apiFetch(`/api/video-updates/categories/${id}`, { method: 'PUT', body: JSON.stringify({ name }) }),
    onSuccess: invalidate,
  })
}

/** 删分类:博主回未分类(服务端 ON DELETE SET NULL)。 */
export function useDeleteVideoCategory() {
  const invalidate = useInvalidateVideo()
  return useMutation({
    mutationFn: (id: number) => apiFetch(`/api/video-updates/categories/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  })
}

/** 整序(ids 新序)。 */
export function useReorderVideoCategories() {
  const invalidate = useInvalidateVideo()
  return useMutation({
    mutationFn: (ids: number[]) =>
      apiFetch('/api/video-updates/categories/reorder', { method: 'PUT', body: JSON.stringify({ ids }) }),
    onSuccess: invalidate,
  })
}
