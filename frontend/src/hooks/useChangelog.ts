import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../api/client'
import { parseChangelog, type ChangelogVersion } from '../lib/changelogParser'

/** /api/changelog 响应(ADR-0017):markdown = 拼装后全文,releasedAt = 最新版 npm 发布时间,
 *  translatedVersions = 已译版本号(UI 对不在此列的版本渲染「翻译」按钮)。 */
type ChangelogResponse = {
  markdown: string
  releasedAt: string | null
  translatedVersions: string[]
}

export type ChangelogData = {
  versions: ChangelogVersion[]
  releasedAt: string | null
  translatedVersions: string[]
}

const fetchChangelog = () => apiFetch<ChangelogResponse>('/api/changelog')

/** 按需补译(ADR-0017):对未译旧版 POST /translate,译毕入库持久化。 */
const translateVersions = (versions: string[]) =>
  apiFetch<ChangelogResponse>('/api/changelog/translate', {
    method: 'POST',
    body: JSON.stringify({ versions }),
  })

/** 经后端 /api/changelog 代理:后端 6 小时定时预取 + 译文按版本块持久化(ADR-0017),
 *  本请求纯读后端快照(最近 N 版中文、已补译旧版中文、其余英文)。
 *  credentials 同 apiFetch,带会话 cookie 通过 /api/** 鉴权。
 *  1h staleTime 只防同会话重复请求——数据新鲜度由后端定时任务保证,与前端无关。
 *  多组件订阅同 queryKey 命中缓存,零额外请求(同 GroupBody 用 useConfig 先例)。 */
export function useChangelog() {
  return useQuery<ChangelogData>({
    queryKey: ['changelog'],
    queryFn: async () => {
      const body = await fetchChangelog()
      return {
        versions: parseChangelog(body.markdown ?? ''),
        releasedAt: body.releasedAt ?? null,
        translatedVersions: body.translatedVersions ?? [],
      }
    },
    staleTime: 60 * 60 * 1000,
  })
}

/** 补译成功后 invalidate ['changelog'] → 重 GET 即含新译文(单向数据流,前端不手工拼译文)。 */
export function useTranslateVersions() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: translateVersions,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['changelog'] }),
  })
}
