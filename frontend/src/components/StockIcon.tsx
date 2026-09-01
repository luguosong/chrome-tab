import { useIconData } from '../context/IconDataContext'
import { extractString } from '../lib/iconData'
import { TILE_FONT_TIERS } from '../lib/iconLayout'
import type { Quote } from '../lib/quoteParser'
import type { Icon } from '../lib/types'
import Tile, { TilePrimary, TileSecondary } from './Tile'

/**
 * 股票图标的专属网格渲染(ADR-0016 单档;注记 2026-08-23b/d 块内两行,c 定名称行):
 * 块内 = 股价(mono,白色——价格是中性事实,视觉主体)+ 变化(mono 次级行,涨跌色)
 * ——2026-09-01 用户立法「块内展示股价+变化」,推翻旧约「1×1 放不下价格、精确价进
 * hover title」;ticker 退出块内,由名称行与 hover title 承接识别。价格中性不染色,
 * 方向信号全由次行色+符号承载——避免整块全红。下方名称行 = 这是什么。名称/sparkline/
 * 市值/PE/行业等富信息全归详情 Modal(StockModal)。价格来自 IconData 集中下发的
 * quotes,无行情时块内退回 ticker 兜底(数据未到,标识先顶);由 Icon.tsx 作为外壳
 * (拖拽/编辑角标/点击派发)在 type==='stock' 时委托调用。
 * 「上块下字」组装与字号档(ADR-0016 注记 e)归 Tile:本组件只剩取数与块内内容。
 */
export default function StockIconBody({ icon, overlay = false }: { icon: Icon; overlay?: boolean }) {
  const { quotes } = useIconData()
  const symbol = extractString(icon.data, 'symbol')
  const name = extractString(icon.data, 'name')
  const q = symbol ? quotes[symbol] ?? null : null
  // 显示串先构造、显示与字号同源取用——字号按 n 字符算而显示 n+1 就破功
  const priceText = q ? q.price.toFixed(2) : null
  const changeText = q ? `${q.change >= 0 ? '+' : ''}${q.change.toFixed(2)}` : null

  return (
    <Tile label={name || symbol || '—'} overlay={overlay}>
      <TilePrimary
        className="font-mono text-white"
        style={priceText ? { fontSize: tileNumFont(priceText, TILE_FONT_TIERS.primary) } : undefined}
        title={q && symbol ? `${symbol} ${fmtPct(q)}` : undefined}
      >
        {priceText ?? symbol ?? '—'}
      </TilePrimary>
      {changeText && (
        // 涨跌额的 +/- 即方向编码,色为冗余备份(报告 2026-08-27 #2 立法「红绿之外须有
        // 独立方向信息」——符号满足,故不再叠 ▲,三重编码啰嗦);2026-09-01 用户立法
        // 涨跌额取代百分比,百分比退 hover title
        <TileSecondary
          className="font-mono"
          style={{ color: toneVar(changeText), fontSize: tileNumFont(changeText, TILE_FONT_TIERS.secondary) }}
        >
          {changeText}
        </TileSecondary>
      )}
    </Tile>
  )
}

function fmtPct(q: Quote): string {
  return `${q.change >= 0 ? '+' : ''}${q.pct.toFixed(2)}% (${q.change >= 0 ? '+' : ''}${q.change.toFixed(2)})`
}

/**
 * 数字行字号随长度自适应(2026-09-01 用户立法「不因过长隐藏/溢出」,股价首用、涨跌额同权):
 * mono 每字符 advance 恒定,故「字符数→字号」是确定性公式,无需测量——
 * n × 0.61em × 字号 ≤ 96% 块宽(0.61 取各平台 mono 最坏宽比 Consolas 0.55 /
 * SF Mono·DejaVu 0.602,4% 余量吸收估计误差)。cqw 随块缩放(矮视口/窄轨压块时公式自动
 * 跟随)。min 追加在档位(tileFont 同源取 TILE_FONT_TIERS)之内:短数零变化,长数只缩不放。
 * 刻意不带 tileFont 的 12px 可读下限——完整性优先于下限(9 字符 ≈9.8px,高分屏仍清晰),
 * 这是数字行对 ADR-0016 档位公式的显式豁免;档位本身不动。
 */
function tileNumFont(text: string, tier: { px: number; cqw: number }): string {
  return `min(${tier.px}px, ${tier.cqw}cqw, ${(96 / (0.61 * text.length)).toFixed(2)}cqw)`
}

/** 涨跌色从显示文本符号推导(与符号同源,色号永不矛盾;-0.00 也归绿)。 */
function toneVar(changeText: string): string {
  return changeText.startsWith('-') ? 'var(--color-down)' : 'var(--color-up)'
}
