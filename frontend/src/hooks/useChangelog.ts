import { useQuery } from '@tanstack/react-query'
import { parseChangelog, type ChangelogVersion } from '../lib/changelogParser'

/** 经后端 /api/changelog 代理：拉取 GitHub 原文 → 译制最近 5 版为中文（旧版保留英文）→ 返回 markdown。
 *  credentials 同 apiFetch，带会话 cookie 通过 /api/** 鉴权。
 *  1h staleTime + 后端哈希缓存共同避免频繁打 GitHub/LLM（见 ADR 0005）。 */
export function useChangelog() {
  return useQuery<ChangelogVersion[]>({
    queryKey: ['changelog'],
    queryFn: async () => {
      const r = await fetch('/api/changelog', { credentials: 'include' })
      if (!r.ok) throw new Error(`拉取失败 (${r.status})`)
      return parseChangelog(await r.text())
    },
    staleTime: 60 * 60 * 1000,
  })
}
