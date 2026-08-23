import { useIconData } from '../context/IconDataContext'
import { useLayoutSettings } from '../context/LayoutSettingsContext'
import { faviconPx } from '../lib/iconLayout'
import { extractString } from '../lib/iconData'
import type { Quote } from '../lib/quoteParser'
import type { Icon } from '../lib/types'
import { IconLabel, TileFrame } from './Icon'

/**
 * 股票图标的专属网格渲染(ADR-0016 单档;注记 2026-08-23b 统一「上块下字」结构,
 * c 定名称行/块内股价):块内两行——ticker 符号(mono,行情终端语汇,视觉主体)
 * + 股价(mono 次级行,涨跌色;与 changelog「版本号+日期」结构对称)——块内 = 当前
 * 状态;下方名称行(用户要求)。名称/sparkline/市值/PE/行业等富信息全归详情
 * Modal(StockModal)。价格来自 IconData 集中下发的 quotes,无行情时块内只渲染 ticker;
 * 由 Icon.tsx 作为外壳(拖拽/编辑角标/点击派发)在 type==='stock' 时委托调用。
 *
 * 块与文字行用全类型共享的 TileFrame / IconLabel(视觉尺寸与行高一致性的来源)。
 * 两行字号均受块宽钳制(min(px, Ncqw))——块是 [container-type:inline-size] 容器
 * (见本组件 TileFrame className),长 ticker(BTC-USD)/长价格随块收缩不溢出,
 * truncate 兜底。
 */
export default function StockIconBody({ icon, overlay = false }: { icon: Icon; overlay?: boolean }) {
  const { quotes } = useIconData()
  const { iconScale } = useLayoutSettings()
  const px = (n: number) => n * iconScale
  const symbol = extractString(icon.data, 'symbol')
  const name = extractString(icon.data, 'name')
  const q = symbol ? quotes[symbol] ?? null : null

  return (
    <>
      <TileFrame
        favPx={faviconPx(iconScale)}
        overlay={overlay}
        className="flex-col gap-[4%] [container-type:inline-size]"
      >
        <span
          className="font-mono text-white leading-none max-w-full truncate"
          style={{ fontSize: `min(${px(14)}px, 24cqw)` }}
        >
          {symbol || '—'}
        </span>
        {q && (
          <span
            className="font-mono leading-none max-w-full truncate"
            style={{ fontSize: `min(${px(13)}px, 20cqw)`, color: toneVar(q) }}
          >
            {q.price.toFixed(2)}
          </span>
        )}
      </TileFrame>
      <IconLabel>{name || symbol || '—'}</IconLabel>
    </>
  )
}

function toneVar(q: Quote): string {
  return q.change >= 0 ? 'var(--color-up)' : 'var(--color-down)'
}
