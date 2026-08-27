import { useState } from 'react'
import type { ServerMonEntry, ServerMonHistoryPoint } from 'chrome-tab-shared'
import { timeAgo } from '../lib/timeAgo'
import { fmtBytes, fmtUptime, useServerHistory, useServers } from '../hooks/useServers'
import ModalShell from './ModalShell'

/**
 * 服务器状态详情 Modal(见 CONTEXT.md「服务器状态」;ADR-0022「更多」标头唯一入口):
 * tab 按机器分页(thinkpad/aliyun),页内 = 概览数字块(uptime/CPU/负载/内存/磁盘/
 * 失败单元)+ CPU·内存 24h sparkline(10min 采样曲线,SVG polyline 零依赖)+
 * 服务/容器状态清单两列(timer 附上次触发结果)。离线降级:显示旧快照 + 陈旧
 * 标注(宁旧勿空,与后端口径一致);从未取到则整页「离线」。
 */
export default function ServersModal({ onClose }: { onClose: () => void }) {
  const { data } = useServers()
  const entries = data ?? []
  // tab 初值随首波数据回落(entries 到达前 active 为 undefined → 空态)
  const [tab, setTab] = useState('')
  const active = entries.find((e) => e.machine === tab) ?? entries[0]
  const hist = useServerHistory(active?.machine ?? '')

  return (
    <ModalShell onClose={onClose} ariaLabel="服务器状态详情" width="2xl" className="p-5">
      {entries.length === 0 ? (
        <EmptyState text={hist.isError ? '服务器数据不可用' : '暂无监控机器(未配置 exporter)'} />
      ) : (
        <>
          <TabBar
            machines={entries.map((e) => e.machine)}
            active={active!.machine}
            onSwitch={setTab}
          />
          <MachinePane entry={active!} points={hist.data?.points ?? []} />
        </>
      )}
    </ModalShell>
  )
}

function TabBar({
  machines,
  active,
  onSwitch,
}: {
  machines: string[]
  active: string
  onSwitch: (m: string) => void
}) {
  return (
    <div role="tablist" className="flex gap-5 border-b border-white/10 px-1">
      {machines.map((m) => (
        <button
          key={m}
          role="tab"
          aria-selected={m === active}
          onClick={() => onSwitch(m)}
          className={`pb-2 text-sm transition-colors ${
            m === active
              ? 'text-white border-b-2 border-white/80'
              : 'text-white/50 hover:text-white/80 border-b-2 border-transparent'
          }`}
        >
          {m}
        </button>
      ))}
    </div>
  )
}

function MachinePane({
  entry,
  points,
}: {
  entry: ServerMonEntry
  points: ServerMonHistoryPoint[]
}) {
  const s = entry.snapshot
  if (!s) return <EmptyState text={`${entry.machine} 离线(无历史快照)`} />
  const online = entry.status === 'online'
  const memUsed = 1 - s.memAvail / s.memTotal
  const diskUsed = 1 - s.diskFree / s.diskTotal
  const cpuHist = points.map((p) => p.cpuPct)
  // 使用率曲线:mem_total 缺于曲线点(采样恒定),以当前快照 total 折算
  const memHist = points.map((p) => (1 - p.memAvail / s.memTotal) * 100)

  return (
    <div className="pt-4 flex flex-col gap-4">
      {!online && (
        <div className="text-xs text-amber-300/90">
          离线降级:以下为 {timeAgo(entry.fetchedAt)} 的最后快照
        </div>
      )}
      <div className="grid grid-cols-3 gap-2">
        <Stat label="在线时长" value={fmtUptime(s.uptimeS)} />
        <Stat label="CPU" value={`${s.cpuPct.toFixed(1)}%`} />
        <Stat label="负载(1m)" value={s.load1.toFixed(2)} />
        <Stat
          label="内存"
          value={`${fmtBytes(s.memTotal - s.memAvail)} / ${fmtBytes(s.memTotal)}(${(memUsed * 100).toFixed(0)}%)`}
        />
        <Stat
          label="磁盘"
          value={`${fmtBytes(s.diskTotal - s.diskFree)} / ${fmtBytes(s.diskTotal)}(${(diskUsed * 100).toFixed(0)}%)`}
        />
        <Stat
          label="失败单元"
          value={`${s.failedUnits}`}
          tone={s.failedUnits > 0 ? 'bad' : undefined}
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Spark label="CPU 24h" unit="%" maxRange={100} values={cpuHist} />
        <Spark
          label="内存使用率 24h"
          unit="%"
          maxRange={100}
          values={memHist}
        />
      </div>
      <div className="grid grid-cols-2 gap-5">
        <StatusList title="服务(systemd)" items={s.services} />
        <StatusList
          title="容器(docker)"
          items={Object.fromEntries(Object.entries(s.containers).map(([k, v]) => [k, { state: v }]))}
        />
      </div>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'bad' }) {
  return (
    <div className="rounded-xl bg-white/5 px-3 py-2">
      <div className="text-xs text-white/45">{label}</div>
      <div className={`text-sm mt-0.5 ${tone === 'bad' ? 'text-red-400' : 'text-white/90'}`}>
        {value}
      </div>
    </div>
  )
}

/** 24h 折线(SVG polyline,preserveAspectRatio=none 拉伸;不足 2 点 = 待积累空态)。 */
function Spark({
  label,
  values,
  maxRange,
  unit,
}: {
  label: string
  values: number[]
  maxRange: number
  unit: string
}) {
  if (values.length < 2)
    return <div className="text-xs text-white/40 py-2">{label}:曲线待积累(10 分钟粒度采样)</div>
  const peak = Math.max(...values)
  const pts = values
    .map((v, i) => `${(i / (values.length - 1)) * 100},${28 - (Math.min(v, maxRange) / maxRange) * 26}`)
    .join(' ')
  return (
    <div>
      <div className="text-xs text-white/45 mb-1">
        {label}(峰值 {peak.toFixed(0)}
        {unit})
      </div>
      <svg viewBox="0 0 100 28" className="w-full h-8" preserveAspectRatio="none" aria-hidden>
        <polyline
          points={pts}
          fill="none"
          stroke="rgba(255,255,255,0.65)"
          strokeWidth="1.2"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  )
}

function StatusList({
  title,
  items,
}: {
  title: string
  items: Record<string, { state: string; result?: string }>
}) {
  const entries = Object.entries(items)
  if (entries.length === 0) return <div className="text-xs text-white/40">{title}:无</div>
  return (
    <div>
      <div className="text-xs text-white/45 mb-1">{title}</div>
      <div className="flex flex-col gap-0.5 text-xs">
        {entries.map(([name, v]) => (
          <div key={name} className="flex items-baseline gap-2">
            <span className="text-white/80 truncate">{name}</span>
            <span className={`ml-auto shrink-0 ${stateTone(v)}`}>{stateText(v)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

const stateTone = (v: { state: string; result?: string }) =>
  v.state === 'active' || v.state === 'running'
    ? 'text-emerald-400/90'
    : v.state === 'failed' || (v.result && v.result !== 'success')
      ? 'text-red-400'
      : 'text-white/45'

const stateText = (v: { state: string; result?: string }) =>
  v.result && v.result !== 'success' ? `${v.state}(${v.result})` : v.state

function EmptyState({ text }: { text: string }) {
  return <div className="py-8 text-center text-sm text-white/40">{text}</div>
}
