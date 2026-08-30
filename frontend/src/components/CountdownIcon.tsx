import { useMemo } from 'react'
import { useLayoutSettings } from '../context/LayoutSettingsContext'
import { describeDays, getAllCountdowns } from '../lib/countdown'
import useNow from '../hooks/useNow'
import type { Icon } from '../lib/types'
import Tile, { TilePrimary, TileSecondary } from './Tile'

/**
 * 倒计时图标的网格渲染(CONTEXT.md「倒计时」,1×1 单例):块内常显**下一条**临近
 * 条目——主行 = 剩余天数(今天/明天/N 天,glance 核心量)、次行 = 条目名(截断,
 * title 全名);不限 30 天窗(常驻图标的意义是看着它逼近),节假日 21 项密集故
 * 恒有下一条。数据 = 「重要日子」(布局设置寄放,ADR-0026)+ 内置「节假日」,
 * 纯前端本地推算(lib/countdown),按天重算(分钟级心跳只管跨天,同 Clock 范式)。
 * 点块打开详情 Modal(编辑唯一入口),由 Icon 外壳经 detailEntry:'block' 派发。
 */
export default function CountdownIconBody({ overlay = false }: { icon: Icon; overlay?: boolean }) {
  const { importantDates } = useLayoutSettings()
  const now = useNow(60_000) // 分钟级心跳:天数按天变
  // 按天重算:dep 是日期键而非 now,心跳不触发(同 Clock 倒计时)
  const dayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`
  const next = useMemo(
    () => getAllCountdowns(now, importantDates)[0] ?? null,
    [dayKey, importantDates], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const dateText =
    next && `${next.date.getMonth() + 1}月${next.date.getDate()}日`

  return (
    <Tile label="倒计时" overlay={overlay}>
      <TilePrimary className="text-white" title={dateText}>
        {next ? describeDays(next.days) : '—'}
      </TilePrimary>
      {next && (
        <TileSecondary className="text-white/60" title={next.name}>
          {next.name}
        </TileSecondary>
      )}
    </Tile>
  )
}
