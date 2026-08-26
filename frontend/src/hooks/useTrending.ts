import { useQuery } from '@tanstack/react-query'
import type { TrendingResponse, TrendingSince } from 'chrome-tab-shared'
import { apiFetch } from '../api/client'

/** 图标卡片与 Modal 的默认视图(今日 + 不限;与后端 cron 保热组合一致,命中缓存零等待)。 */
export const DEFAULT_TRENDING_QUERY = { since: 'daily', language: '', spoken: '' } as const

/**
 * GitHub 趋势取数(单例图标「GitHub 趋势」,CONTEXT.md;数据 = 后端 trending 页 HTML
 * 解析、默认组合 cron 1h 保热、其余组合现抓 + 内存缓存,ADR-0028——前端只读)。
 * 不进 IconDataContext 集中层:单例无批量红利,且未添加该图标的用户不应发请求
 * (同 aihot/todo/video/model/news 先例)。图标 body 与 Modal 同筛选同 queryKey
 * 天然去重;筛选即 queryKey,切换组合自动现拉。staleTime 5min + 窗口聚焦重拉
 * 即产品天然刷新节奏(同 video/model/news)。
 */
export function useTrending(query: { since: TrendingSince; language: string; spoken: string }) {
  const { since, language, spoken } = query
  return useQuery<TrendingResponse>({
    queryKey: ['trending', since, language, spoken],
    queryFn: () =>
      apiFetch<TrendingResponse>(
        `/api/trending?since=${since}` +
          (language ? `&language=${encodeURIComponent(language)}` : '') +
          (spoken ? `&spoken=${encodeURIComponent(spoken)}` : ''),
      ),
    staleTime: 5 * 60_000,
    retry: 1,
  })
}
