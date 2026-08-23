import { useIconData } from '../context/IconDataContext'
import { extractString } from '../lib/iconData'
import type { Quote } from '../lib/quoteParser'
import type { Icon } from '../lib/types'
import Tile, { TilePrimary, TileSecondary } from './Tile'

/**
 * 股票图标的专属网格渲染(ADR-0016 单档;注记 2026-08-23b/d 块内两行,c 定名称行):
 * 块内 = ticker 符号(mono,行情终端语汇,视觉主体)+ 股价(mono 次级行,涨跌色)——
 * 当前状态;下方名称行 = 这是什么。名称/sparkline/市值/PE/行业等富信息全归详情
 * Modal(StockModal)。价格来自 IconData 集中下发的 quotes,无行情时块内只渲染 ticker;
 * 由 Icon.tsx 作为外壳(拖拽/编辑角标/点击派发)在 type==='stock' 时委托调用。
 * 「上块下字」组装与字号档(ADR-0016 注记 e)归 Tile:本组件只剩取数与块内内容。
 */
export default function StockIconBody({ icon, overlay = false }: { icon: Icon; overlay?: boolean }) {
  const { quotes } = useIconData()
  const symbol = extractString(icon.data, 'symbol')
  const name = extractString(icon.data, 'name')
  const q = symbol ? quotes[symbol] ?? null : null

  return (
    <Tile label={name || symbol || '—'} overlay={overlay}>
      <TilePrimary className="font-mono text-white">{symbol || '—'}</TilePrimary>
      {q && (
        <TileSecondary className="font-mono" style={{ color: toneVar(q) }}>
          {q.price.toFixed(2)}
        </TileSecondary>
      )}
    </Tile>
  )
}

function toneVar(q: Quote): string {
  return q.change >= 0 ? 'var(--color-up)' : 'var(--color-down)'
}
