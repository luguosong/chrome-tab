import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { TrendingKnownMarks, TrendingResponse, TrendingSince } from 'chrome-tab-shared'
import { apiFetch } from '../api/client'
import { isTranslateFresh } from '../lib/trending'
import { authoritativeCallbacks } from '../lib/optimisticMutation'

/** 图标卡片与 Modal 的默认视图(今日 + 不限;与后端 cron 保热组合一致,命中缓存零等待)。 */
export const DEFAULT_TRENDING_QUERY = { since: 'daily', language: '', spoken: '' } as const

/**
 * GitHub 趋势取数(单例图标「GitHub 趋势」,CONTEXT.md;数据 = 后端 trending 页 HTML
 * 解析、默认组合 cron 1h 保热、其余组合现抓 + 内存缓存,ADR-0028——前端只读)。
 * 不进 IconDataContext 集中层:单例无批量红利,且未添加该图标的用户不应发请求
 * (同 aihot/todo/video/model/news 先例)。图标 body 与 Modal 同筛选同 queryKey
 * 天然去重;筛选即 queryKey,切换组合自动现拉。staleTime 5min + 窗口聚焦重拉
 * 即产品天然刷新节奏(同 video/model/news)。
 *
 * 译制到达轮询(ADR-0030 fire-and-forget 的另一半):后端首批响应常带「有原文
 * 无译文」条目(批译后台进行中),仅靠聚焦重拉要等数分钟才见中文。存在此类条目
 * 且处于补译新鲜窗内时 15s 轻拉接力——打在后端内存缓存 join 上,毫秒级零 LLM 消耗;
 * 译文到齐或超出新鲜窗(LLM 全链失效等)即自停。retryAt = 手动「重试翻译」点击时刻,
 * 把窗口从 fetchedAt 起点拉回当下,让重试后的轮询复活。
 */
export function useTrending(
  query: { since: TrendingSince; language: string; spoken: string },
  opts: { retryAt?: number } = {},
) {
  const { since, language, spoken } = query
  const retryAt = opts.retryAt ?? 0
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
    refetchInterval: (q) => {
      // wire 形状防御(2026-08-27 白屏事故):data 形状由后端决定,repos 非数组时
      // 绝不裸调方法——响应层契约错位只应表现为「无数据」,不能崩整页 React 树
      const list = q.state.data?.repos
      if (!Array.isArray(list)) return false
      const pending = list.some((x) => x.description != null && x.descriptionZh == null)
      return pending && isTranslateFresh(q.state.data?.fetchedAt, retryAt) ? 15_000 : false
    },
  })
}

/** 手动触发一轮补译(fire-and-forget,POST /api/trending/retry-translation):
 *  后端立即返回,译文到库靠调用方随后的到达轮询收果。 */
export function retryTrendingTranslation(query: {
  since: string
  language: string
  spoken: string
}) {
  const qs =
    `/api/trending/retry-translation?since=${query.since}` +
    (query.language ? `&language=${encodeURIComponent(query.language)}` : '') +
    (query.spoken ? `&spoken=${encodeURIComponent(query.spoken)}` : '')
  return apiFetch<{ started: boolean }>(qs, { method: 'POST' })
}

// ── 已了解标记(CONTEXT.md「已了解」):账号级项目持久勾,块内与 Modal 同 queryKey 去重 ──

const KNOWN_MARKS_KEY = ['trending-known-marks'] as const

/** 已了解 repo 全量(随 GitHub 趋势图标/Modal 挂载才取,未添加不发请求——同 useTrending 先例)。 */
export function useKnownMarks() {
  return useQuery<TrendingKnownMarks>({
    queryKey: KNOWN_MARKS_KEY,
    queryFn: () => apiFetch<TrendingKnownMarks>('/api/trending/marks'),
    staleTime: 5 * 60_000,
    retry: 1,
  })
}

/** 消费形态:渲染判定的 Set 版(块内与 Modal 同用;查询空态回落空集)。 */
export function useKnownSet() {
  const { data } = useKnownMarks()
  return useMemo(() => new Set(data ?? []), [data])
}

/** 标记/取消(响应 = 写后全量,onSuccess 权威写走 authoritativeCallbacks 出口
 *  ——同 useSetNewsSources;SQLite 点写毫秒级,不做乐观回滚机制)。失败静默:
 *  缓存不动,行保持原状。 */
export function useSetKnownMark() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ repo, known }: { repo: string; known: boolean }) =>
      known
        ? apiFetch<TrendingKnownMarks>('/api/trending/marks', { method: 'PUT', body: JSON.stringify({ repo }) })
        : apiFetch<TrendingKnownMarks>(`/api/trending/marks?repo=${encodeURIComponent(repo)}`, { method: 'DELETE' }),
    ...authoritativeCallbacks<TrendingKnownMarks>(qc, KNOWN_MARKS_KEY),
  })
}
