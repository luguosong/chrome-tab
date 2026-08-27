import type { CSSProperties, ReactNode } from 'react'
import { useLayoutSettings } from '../context/LayoutSettingsContext'
import { ICON_SCALE, faviconPx, ghostWidth3Cols, labelBlockPx, LABEL_LINE_HEIGHT, tileFont, type TileFontTier } from '../lib/iconLayout'

/**
 * 「上块下字」外壳(ADR-0016 注记 b/c/d 的结构,e 起收拢为本深 module):
 * 图标本体玻璃块 + 外置名称行,全类型(网站链接/分组/自选股/天气/更新日志)唯一的
 * 组装口径。此前 TileFrame/IconLabel/px()/min(px,cqw) 公式散在各 body 重复——
 * 「上块下字」的实现名即 Tile(领域概念仍是 CONTEXT.md「图标」,Tile 仅指本外壳)。
 *
 * interface 极小:Tile(块内 children + label + overlay)、TilePrimary/TileSecondary
 * (主/次行字号档,ADR-0016 注记 e 全类型统一)。缩放系数是代码常量 ICON_SCALE
 * (ADR-0033,撤除用户调节);字号档唯一来源 lib/iconLayout 的
 * TILE_FONT_TIERS——调字号只改一处。
 */

/** 名称行(私有):显隐/字号/颜色随「布局设置」,行高与 lib 常数同源(见 labelBlockPx)。 */
function IconLabel({ children }: { children: ReactNode }) {
  const { labelVisible, labelSize, labelColor } = useLayoutSettings()
  if (!labelVisible) return null
  return (
    <span
      className="shrink-0 max-w-full truncate text-center"
      style={{ fontSize: labelSize, lineHeight: LABEL_LINE_HEIGHT, color: labelColor }}
    >
      {children}
    </span>
  )
}

/**
 * 图标本体玻璃块(私有,ADR-0015 修订;ADR-0016 注记 2026-08-23b 起为**全类型**统一外壳):
 * squircle 玻璃容器即图标本体——块内主体(favicon / 分组预览 / ticker / 状况图标 /
 * 版本号)在块内居中,边长推导同一 faviconPx——视觉尺寸一致由共享几何保证。名称行
 * 在块外画格上(iOS 主屏层级:块=图标本体,文字=壁纸层)。
 * 块边 = min(推导值, 画格可用高度)——maxWidth/maxHeight 双上限 + aspect-square 与
 * favicon 时代的收缩机制同款(同档位画格等高,收缩全体一致);overlay 幽灵无画格约束
 * (shrink-wrap),固定推导值。hover/active 缩放作用于**整块**,提亮由 .glass-soft
 * 自身规则承担(ADR-0012)。
 */
function TileFrame({
  favPx,
  padPx = 0,
  bare = false,
  fill = false,
  overlay,
  className = '',
  children,
}: {
  favPx: number
  padPx?: number
  /** 裸块(ADR-0015 注记 2026-08-23c,即回归 ADR-0013):省略玻璃材质,几何骨架照旧。 */
  bare?: boolean
  /** 跨格撑满块(天气 3×1):aspect-square/bound 钳制让位于画格几何(同 BigTile 思路,
   *  但仍是「上块下字」外壳——名称行/字号档照旧);无 hover 缩放(块已撑满画格)。 */
  fill?: boolean
  overlay: boolean
  className?: string
  children: ReactNode
}) {
  const bound = favPx + padPx * 2
  const { labelVisible, labelSize } = useLayoutSettings()
  return (
    <div
      className={
        // flex 居中:块内主体在块内居中;nav favicon 与分组预览是 w-full/h-full
        // 撑满式,不受影响。Tile 固定追加块内纵排 + inline-size 容器(字号 cqw 钳制)。
        // bare 时不挂 glass-soft:hover 提亮随之消失,反馈只剩下方 hover 缩放(0013 语言)。
        // 圆角:单格 22% 近似 squircle(正方形上 x/y 半径相等);fill 跨格块是宽扁形,
        // 百分比圆角会椭圆化(角与直边衔接处曲率突变,观感「有棱角」),改固定圆角,
        // 与 BigTile(3×2 跨格先例)rounded-3xl 同口径。
        (bare ? '' : 'glass-soft ' + (fill ? 'rounded-3xl ' : 'rounded-[22%] ')) +
        'flex items-center justify-center ' +
        (!overlay
          ? fill
            ? // fill:撑满画格(宽随 span 格数,高 = 行高 − 名称行),不缩放
              'flex-1 min-h-0 w-full '
            : 'flex-1 min-h-0 aspect-square transition-transform hover:scale-110 active:scale-95 '
          : '') +
        className
      }
      style={
        overlay
          ? fill
            ? // fill 幽灵在画格外,按 3×1 近似估形(宽口径同 BigTile;高含名称行)。
              // ponytail: 列数写死 3——出现其他 fill 跨度再参数化。
              {
                width: ghostWidth3Cols(favPx),
                height: favPx + labelBlockPx(labelVisible, labelSize),
                padding: padPx,
              }
            : { width: bound, height: bound, padding: padPx }
          : fill
            ? // fill:撑满画格,无钳制(画格几何即块几何)
              { padding: padPx }
            : {
                // maxWidth 取 min(推导值, 画格宽):行高改由图标几何推导(iconCellGeometry)
                // 后轨道宽是防重叠的硬上限——极端窄轨(如 gridWidth 最小 + 大间距)时块
                // 宁可收缩也不侵入相邻画格;min() 是兜底,常规由几何层先钳。
                maxWidth: `min(${bound}px, 100%)`,
                maxHeight: bound,
                padding: padPx,
              }
      }
    >
      {children}
    </div>
  )
}

/** 主/次行共用渲染(私有):字号档 + 截断;mono/颜色由调用方 className/style 追加。 */
type TileTextProps = { className?: string; style?: CSSProperties; children: ReactNode; title?: string }

function TileText({ tier, className = '', style, children, title }: TileTextProps & { tier: TileFontTier }) {
  return (
    <span
      title={title}
      className={`leading-none max-w-full truncate ${className}`}
      style={{ fontSize: tileFont(ICON_SCALE, tier), ...style }}
    >
      {children}
    </span>
  )
}

/** 主行(块内视觉主体):14px/24cqw 档(ADR-0016 注记 e);mono/颜色由调用方追加。 */
export function TilePrimary(props: TileTextProps) {
  return <TileText tier="primary" {...props} />
}

/** 次行(块内次级数据):12px/20cqw 档;mono/涨跌色由调用方追加。 */
export function TileSecondary(props: TileTextProps) {
  return <TileText tier="secondary" {...props} />
}

/**
 * 单个图标的「上块下字」组装:玻璃块(块内 children 纵排,gap-[4%] + inline-size
 * 容器使字号随块宽钳制)+ 外置名称行(label,随「布局设置」显隐;空值不渲染行)。
 * overlay = DragOverlay 拖拽幽灵(块脱离画格约束,固定推导边长)。padPx 供分组块
 * 内边距(GROUP_PAD_PX,块边 = favPx + 2×pad)。
 */
export default function Tile({
  label,
  overlay = false,
  padPx = 0,
  bare = false,
  fill = false,
  children,
}: {
  /** 名称行文本;空串不渲染行(显隐仍由「布局设置」管)。 */
  label?: string
  overlay?: boolean
  padPx?: number
  /** 裸块:不渲染玻璃底板(仅 nav,ADR-0015 注记 2026-08-23c);几何/名称行照常。 */
  bare?: boolean
  /** 跨格撑满块(天气 3×1):块撑满画格,名称行照旧外置;与 bare 正交。 */
  fill?: boolean
  children: ReactNode
}) {
  return (
    <>
      <TileFrame
        favPx={faviconPx(ICON_SCALE)}
        padPx={padPx}
        bare={bare}
        fill={fill}
        overlay={overlay}
        className="flex-col gap-[4%] [container-type:inline-size]"
      >
        {children}
      </TileFrame>
      {label ? <IconLabel>{label}</IconLabel> : null}
    </>
  )
}
