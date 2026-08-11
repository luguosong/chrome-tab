import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from './client'
import type { Config, Icon, IconSize, IconTypeId, Setting } from '../lib/types'

/**
 * 后端返回的原始聚合(JSON)。与 Config 不同处:icons 的 type/size 是大写枚举串
 * ("NAV"/"SMALL"…),这里镜像后端 wire format,normalize 后再交给 Config。
 */
type RawConfig = Omit<Config, 'icons'> & {
  icons: Array<{
    id: number
    pageId: number
    type: string
    size: string
    sortOrder: number
    data: Record<string, unknown> | null
  }>
}

/** 把后端大写枚举归一化为前端小写 id;未知值原样保留(扩展点:未来新增类型先这样降级)。 */
function normalizeIcon(i: RawConfig['icons'][number]): Icon {
  return {
    ...i,
    type: i.type.toLowerCase() as IconTypeId,
    size: i.size.toLowerCase() as IconSize,
  }
}

/** 配置聚合：首屏一次取齐 pages/icons/setting;mutation 后 invalidate 重拉。 */
export function useConfig() {
  return useQuery<Config>({
    queryKey: ['config'],
    queryFn: async () => {
      const raw = await apiFetch<RawConfig>('/api/config')
      return { ...raw, icons: raw.icons.map(normalizeIcon) }
    },
  })
}

export function useUpdateSetting() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (theme: string) =>
      apiFetch<Setting>('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({ theme }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['config'] }),
  })
}
