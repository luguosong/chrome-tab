import { useQuery } from '@tanstack/react-query'
import type { ServerMonEntry, ServerMonHistoryPoint } from 'chrome-tab-shared'
import { apiFetch } from '../api/client'

/**
 * 服务器状态取数(单例图标「服务器」,CONTEXT.md「服务器状态」;数据 = thinkpad/
 * aliyun 上 servermon exporter → 后端 60s TTL 快照 + 10min 采样落库,前端只读)。
 * 不进 IconDataContext 集中层:单例无批量红利(同 aihot/todo/video/model/news/trending
 * 先例)。1min 轮询对齐后端快照 TTL——在线状态语义要求近实时。
 */
export function useServers() {
  return useQuery({
    queryKey: ['servers'],
    queryFn: () => apiFetch<ServerMonEntry[]>('/api/servers'),
    staleTime: 60_000,
    refetchInterval: 60_000,
  })
}

/** 24h 数值曲线(10min 粒度采样;Modal sparkline 用)。machine 空(清单未到/
 * 未配置)时禁用——后端 machine 必填,空发必 400。 */
export function useServerHistory(machine: string) {
  return useQuery({
    queryKey: ['server-history', machine],
    queryFn: () =>
      apiFetch<{ machine: string; points: ServerMonHistoryPoint[] }>(
        `/api/servers/history?machine=${encodeURIComponent(machine)}`,
      ),
    enabled: machine !== '',
    staleTime: 5 * 60_000,
  })
}

// ── 展示格式化(tile 与 Modal 共用;数据形状的伴生函数)────────────────────────

/** bytes → 人性化(整数位自适应 G/T,内存磁盘两用)。 */
export const fmtBytes = (b: number): string => {
  const gib = b / 1024 ** 3
  if (gib >= 1024) return `${(gib / 1024).toFixed(1)}T`
  return gib >= 10 ? `${gib.toFixed(0)}G` : `${gib.toFixed(1)}G`
}

/** 秒 → 「N 天 N 时 / N 时 N 分 / N 分」。 */
export const fmtUptime = (s: number): string => {
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  if (d > 0) return `${d} 天 ${h} 时`
  if (h > 0) return `${h} 时 ${Math.floor((s % 3600) / 60)} 分`
  return `${Math.floor(s / 60)} 分`
}
