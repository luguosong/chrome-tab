import { useQuery } from '@tanstack/react-query'
import { parseChangelog, type ChangelogVersion } from '../lib/changelogParser'

export type ChangelogData = { versions: ChangelogVersion[]; releasedAt: string | null }

/** 经后端 /api/changelog 代理：拉取 GitHub 原文 → 译制最近 5 版为中文（旧版保留英文）→
 *  返回 { markdown, releasedAt }（releasedAt = 最新版 npm 发布时间，ADR-0016；原文无日期只能外取）。
 *  credentials 同 apiFetch，带会话 cookie 通过 /api/** 鉴权。
 *  1h staleTime + 后端哈希缓存共同避免频繁打 GitHub/LLM/npm（见 ADR 0005）。
 *  多组件订阅同 queryKey 命中缓存，零额外请求（同 GroupBody 用 useConfig 先例）。 */
export function useChangelog() {
  return useQuery<ChangelogData>({
    queryKey: ['changelog'],
    queryFn: async () => {
      const r = await fetch('/api/changelog', { credentials: 'include' })
      if (!r.ok) throw new Error(`拉取失败 (${r.status})`)
      const body = (await r.json()) as { markdown?: string; releasedAt?: string | null }
      return {
        versions: parseChangelog(body.markdown ?? ''),
        releasedAt: body.releasedAt ?? null,
      }
    },
    staleTime: 60 * 60 * 1000,
  })
}
