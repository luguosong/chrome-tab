import { timeAgo } from '../lib/timeAgo'
import { ICON_SCALE, tileFont } from '../lib/iconLayout'
import type { Icon } from '../lib/types'
import { useServers } from '../hooks/useServers'
import BigTile from './BigTile'
import type { ServerMonEntry } from 'chrome-tab-shared'

/**
 * 服务器状态图标的专属网格渲染(见 CONTEXT.md「服务器状态」;3×2 大 tile,
 * ADR-0021/0022 范式):外壳/标头走 BigTile(鲜度 = 最新快照时刻),主体 = 每台
 * 机器一行**简单信息**(状态点 + 机器名 + CPU/内存百分比);详细(服务清单/容器/
 * 24h 曲线)走 Modal tab 页。数据自持 useServers(后端 60s TTL 快照)。
 */
export default function ServersIconBody({
  icon,
  overlay = false,
  onOpenDetail,
}: {
  icon: Icon
  overlay?: boolean
  /** 「更多」按钮直调(ADR-0022);undefined = 编辑模式/overlay,按钮不渲染。 */
  onOpenDetail?: () => void
}) {
  void icon // 单例无实例参数(data 无字段);保留形参对齐其它 body 的接口
  const { data } = useServers()
  const fontSize = tileFont(ICON_SCALE, 'secondary')
  const entries = data ?? []
  const fresh = entries.reduce<string | null>(
    (acc, e) => (e.fetchedAt && (!acc || e.fetchedAt > acc) ? e.fetchedAt : acc),
    null,
  )

  return (
    <BigTile
      title="服务器"
      fresh={fresh}
      freshLabel="快照"
      onOpenDetail={onOpenDetail}
      moreTitle="服务器详情"
      overlay={overlay}
    >
      {entries.length === 0 ? null : (
        <div className="flex flex-col min-h-0 overflow-y-auto modal-scroll">
          {entries.map((e) => (
            <MachineRow key={e.machine} entry={e} fontSize={fontSize} />
          ))}
        </div>
      )}
    </BigTile>
  )
}

function MachineRow({ entry, fontSize }: { entry: ServerMonEntry; fontSize: string }) {
  const s = entry.snapshot
  const online = entry.status === 'online' && s != null
  return (
    <div className="flex items-center gap-2 px-3 py-1.5" style={{ fontSize }}>
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${online ? 'bg-emerald-400' : 'bg-red-400'}`}
        aria-hidden
      />
      <span className="text-white/90 truncate">{entry.machine}</span>
      {online ? (
        <span className="ml-auto text-white/55 shrink-0">
          CPU {s.cpuPct.toFixed(0)}% · 内存 {((1 - s.memAvail / s.memTotal) * 100).toFixed(0)}%
        </span>
      ) : (
        <span className="ml-auto text-white/55 shrink-0">
          {s ? `离线 · 数据 ${timeAgo(entry.fetchedAt)}` : '离线'}
        </span>
      )}
    </div>
  )
}
