import { useIconData } from '../context/IconDataContext'
import { useLayoutSettings } from '../context/LayoutSettingsContext'
import { extractString } from '../lib/iconData'
import type { Quote } from '../lib/quoteParser'
import type { Icon } from '../lib/types'

/**
 * 股票图标的专属网格渲染(ADR-0016 单档极简:1×1 只显示 名称 + 当前价,价格带涨跌色)。
 * 涨跌幅、sparkline、市值/PE/行业等富信息全归详情 Modal(StockModal)。
 * 价格来自 IconData 集中下发的 quotes;本组件只负责"网格内"视觉,
 * 由 Icon.tsx 作为外壳(拖拽/编辑角标/点击派发)在 type==='stock' 时委托调用。
 *
 * 字号随「布局设置」的 iconScale 同比缩放(基础 px × iconScale,1.5=默认),但价格行
 * 受卡宽钳制:min(px, 18cqw)——卡是 [container-type:size] 容器(Icon.tsx 外壳),
 * cqw 随卡内容盒自适应(gridWidth/视口变化联动),18cqw 保 9 位价格(如 103266.53)
 * 不溢出;更长极端位数由 truncate 兜底(同 ChangelogIcon 防溢出模式)。否则
 * iconScale 调大/价格位数多时文字溢出卡片被裁剪(卡宽不随 iconScale 变化)。
 */
export default function StockIconBody({ icon }: { icon: Icon }) {
  const { quotes } = useIconData()
  const { iconScale } = useLayoutSettings()
  const px = (n: number) => n * iconScale
  const symbol = extractString(icon.data, 'symbol')
  const name = extractString(icon.data, 'name') || symbol
  const q = symbol ? quotes[symbol] ?? null : null

  return (
    <div className="w-full h-full flex flex-col justify-between">
      <span className="text-white/70 truncate" style={{ fontSize: px(10) }}>{name}</span>
      <span
        className={`font-mono leading-none truncate ${q ? tone(q) : 'text-white/40'}`}
        style={{ fontSize: `min(${px(15)}px, 18cqw)` }}
      >
        {q ? q.price.toFixed(2) : '—'}
      </span>
    </div>
  )
}

function tone(q: Quote): string {
  return q.change >= 0 ? 'text-up' : 'text-down'
}
