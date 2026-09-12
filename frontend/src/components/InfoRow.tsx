import { type ReactNode } from 'react'
import { FreshDot } from './TileBody'

/**
 * 信息流行壳(行壳票 01,ADR-0040 注记):详情 Modal 列表行的结构单点——
 * pill 容器 + 主行(红点槽 + 标题)+ 次行(meta)+ 可选前置槽。行的「结构三件套」
 * 收壳,字段选择与异质内容留域(ADR-0040「内容永远留域」在行层的再裁决):
 *  - leading:前置槽,具象自持(视频缩略图/AI 热点排名序号);有前置槽行转横排
 *    (flex gap-3),内容列 flex-col、meta 钉底(缩略图行高大于文字时对齐);
 *  - title:纯文本,或域自嵌 <a>(AI 热点条目链接可选);titleLines=2 两行钳制 +
 *    break-all(新闻/视频防长标题/长词撑爆行),缺省自然换行(AI 热点 leading-snug);
 *  - meta:字符串(「·」拼接)或域自持分段节点(AI 热点「N 源」「原文」次链)——
 *    分段节点自带排版(text-meta/flex),覆盖壳的 text-xs 基底;
 *  - fresh:红点判据由域算好传入(isFreshRow / isFreshModelEvent——判定单点在
 *    lib/tileBody 与域规则,壳只管槽位;FreshDot 唯一正宗在 TileBody);
 *  - href:有则整行外跳(新标签);缺省行静止(标题链接归 title 节点);
 *  - className:方言逃生口(DetailModal/ModalShell 同先例)——AI 热点族的
 *    px-3 py-2.5 + active 态在此追加,轴向前缀覆盖默认 p-2;
 *  - children:meta 之后的行尾附加(AI 日报条目的 summary 段落)。
 */
export interface InfoRowProps {
  readonly leading?: ReactNode
  readonly title: ReactNode
  readonly href?: string
  readonly titleLines?: 2
  readonly meta?: ReactNode
  readonly fresh?: boolean
  readonly className?: string
  readonly children?: ReactNode
}

export default function InfoRow({
  leading,
  title,
  href,
  titleLines,
  meta,
  fresh,
  className,
  children,
}: InfoRowProps) {
  const titleLine = (
    <span className="flex items-start gap-1.5">
      {/* 两行钳制标题红点顶对齐首行(mt-1.5);自然换行标题行高可变,回 FreshDot
          缺省 self-center(单行/居中行 no-op,多行随盒居中) */}
      <FreshDot show={fresh === true} className={titleLines === 2 ? 'mt-1.5' : undefined} />
      <span
        className={'text-sm text-white/90' + (titleLines === 2 ? ' line-clamp-2 break-all' : ' leading-snug')}
      >
        {title}
      </span>
    </span>
  )
  const body =
    leading !== undefined ? (
      <>
        {leading}
        <span className="flex-1 min-w-0 flex flex-col py-0.5">
          {titleLine}
          {meta !== undefined && <span className="mt-auto pt-1 text-xs text-white/45">{meta}</span>}
          {children}
        </span>
      </>
    ) : (
      <>
        {titleLine}
        {meta !== undefined && <span className="mt-0.5 block text-xs text-white/45">{meta}</span>}
        {children}
      </>
    )
  const pill =
    (leading !== undefined ? 'flex gap-3 ' : 'block ') +
    'rounded-xl p-2 hover:bg-white/10 transition-colors' +
    (className !== undefined ? ' ' + className : '')
  return (
    <li>
      {href !== undefined ? (
        <a href={href} target="_blank" rel="noreferrer" className={pill}>
          {body}
        </a>
      ) : (
        <div className={pill}>{body}</div>
      )}
    </li>
  )
}
