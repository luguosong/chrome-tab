import { useQuery } from '@tanstack/react-query'
import { parseChangelog, type ChangelogVersion } from '../lib/changelogParser'

const CL_URL = 'https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md'

/** 拉取 + 解析 CHANGELOG.md。raw.githubusercontent.com 带 ACAO:*，浏览器可直连。
 *  1h staleTime：changelog 更新不频繁，避免每次进页面都打 GitHub。 */
export function useChangelog() {
  return useQuery<ChangelogVersion[]>({
    queryKey: ['changelog'],
    queryFn: async () => {
      const r = await fetch(CL_URL, { cache: 'no-store' })
      if (!r.ok) throw new Error(`拉取失败 (${r.status})`)
      return parseChangelog(await r.text())
    },
    staleTime: 60 * 60 * 1000,
  })
}
