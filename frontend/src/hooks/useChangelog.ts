import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../api/client'
import { parseChangelog, type ChangelogVersion } from '../lib/changelogParser'
import { DEFAULT_CHANGELOG_SOURCE, type ChangelogSourceId } from 'chrome-tab-shared'

/** /api/changelog 响应(ADR-0017/0022):markdown = 拼装后全文,releasedAt = 最新版
 *  发布时间,releaseTimes = 每版本发布时间全表(版本号→ISO,空表 = 发布信息失败/恢复窗口,
 *  版本行时间降级不显示),translatedVersions = 已译版本号(UI 对不在此列的版本渲染「翻译」按钮)。 */
type ChangelogResponse = {
  markdown: string
  releasedAt: string | null
  releaseTimes: Record<string, string>
  translatedVersions: string[]
}

export type ChangelogData = {
  versions: ChangelogVersion[]
  releasedAt: string | null
  releaseTimes: Record<string, string>
  translatedVersions: string[]
}

const fetchChangelog = (source: ChangelogSourceId) =>
  apiFetch<ChangelogResponse>(`/api/changelog?source=${source}`)

/** 按需补译(ADR-0017):对未译旧版 POST /translate,译毕入库持久化。 */
const translateVersions = (source: ChangelogSourceId, versions: string[]) =>
  apiFetch<ChangelogResponse>(`/api/changelog/translate?source=${source}`, {
    method: 'POST',
    body: JSON.stringify({ versions }),
  })

/** 经后端 /api/changelog 代理:后端 6 小时定时预取 + 译文按版本块持久化(ADR-0017),
 *  本请求纯读后端快照(最近 N 版中文、已补译旧版中文、其余英文)。
 *  多源(ADR-0020):queryKey 带 source,同源多组件命中同一缓存,零额外请求。
 *  credentials 同 apiFetch,带会话 cookie 通过 /api/** 鉴权。
 *  1h staleTime 只防同会话重复请求——数据新鲜度由后端定时任务保证,与前端无关。 */
export function useChangelog(source: ChangelogSourceId = DEFAULT_CHANGELOG_SOURCE) {
  return useQuery<ChangelogData>({
    queryKey: ['changelog', source],
    queryFn: async () => {
      const body = await fetchChangelog(source)
      return {
        versions: parseChangelog(body.markdown ?? ''),
        releasedAt: body.releasedAt ?? null,
        releaseTimes: body.releaseTimes ?? {},
        translatedVersions: body.translatedVersions ?? [],
      }
    },
    staleTime: 60 * 60 * 1000,
  })
}

/** 补译成功后 invalidate 本源 → 重 GET 即含新译文(单向数据流,前端不手工拼译文)。 */
export function useTranslateVersions(source: ChangelogSourceId = DEFAULT_CHANGELOG_SOURCE) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (versions: string[]) => translateVersions(source, versions),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['changelog', source] }),
  })
}
