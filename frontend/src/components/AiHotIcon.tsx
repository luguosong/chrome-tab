import { useAiHotDaily } from '../hooks/useAiHot'
import { extractString } from '../lib/iconData'
import { ICON_SCALE, tileFont } from '../lib/iconLayout'
import { useEditMode } from '../context/EditModeContext'
import type { Icon } from '../lib/types'
import BigTile from './BigTile'
import { TileBody, TileRow } from './TileBody'

/**
 * AI 热点图标的专属网格渲染(见 CONTEXT.md「AI 热点」;ADR-0021 跨格大 tile):
 * 外壳/标头走 BigTile(ADR-0022 抽取),主体 = AI 日报标题列表(2026-08-25 迭代,
 * 原热点榜移回 Modal)——日报无排名,不放序号,透出上游五分类编组作为唯一结构
 * (分类标头 accent 弱色,Modal 日报 tab 同款);标题单行截断(日报 20~30 条,
 * 单行保列表密度,完整标题走悬浮 title 与 Modal)。点击派发(ADR-0022):整块
 * 点击无操作,详情 Modal(AiHotModal,默认 tab 即日报)入口 = 标头「更多」按钮;
 * 条目链接 stopPropagation 外跳 AIHOT 阅读页,编辑模式渲染纯文本。鲜度位显示
 * 出刊推定时刻:日报只带日期粒度,按上游「每早八时(北京时间)定稿」补 T08:00
 * 时区偏移,由 timeAgo 显示「N 小时前」——日期粒度下的最诚实表达。空刊/取数
 * 失败降级 ···(BigTile 空态,重试入口在 Modal)。数据自持 useAiHotDaily
 * (定稿快照,同 hook 无轮询,Modal 日报 tab 同 queryKey 去重)。
 */
export default function AiHotIconBody({
  icon,
  overlay = false,
  onOpenDetail,
}: {
  icon: Icon
  overlay?: boolean
  /** 「更多」按钮直调(ADR-0022);undefined = 编辑模式/overlay,按钮不渲染。 */
  onOpenDetail?: () => void
}) {
  const { data } = useAiHotDaily()
  const { editing } = useEditMode()
  const name = extractString(icon.data, 'name') || 'AI 热点'
  const sections = (data?.sections ?? []).filter((s) => s.items.length > 0)
  const fresh = data?.date ? `${data.date}T08:00:00+08:00` : null
  const fontSize = tileFont(ICON_SCALE, 'secondary')

  return (
    <BigTile
      title={name}
      titleHref="https://aihot.virxact.com/"
      titleLinkHint="打开 AIHOT 站点"
      fresh={fresh}
      onOpenDetail={onOpenDetail}
      moreTitle="查看完整日报"
      overlay={overlay}
    >
      {sections.length === 0 ? null : (
        // 全量翻阅(cap={null} 显式声明,见「块内主体」):日报一期条目少,30 行窗不适用
        <TileBody
          as="div"
          cap={null}
          rows={sections.map((s, si) => (
            // 分类间距挂 section:first-child(标头 div 恒为 section 首子,first: 挂它身上恒真)
            <section key={si} className="mt-2 first:mt-0">
              <div className="px-2 pb-0.5 text-accent" style={{ fontSize }}>
                {s.label}
              </div>
              <ul>
                {s.items.map((it, ii) => (
                  // 条目 key 双下标:定稿快照渲染期不重排,安全(见 lib/aihot.ts 类型注释)
                  <TileRow key={ii} interactive="hover" className="min-w-0">
                    {it.aihotUrl && !editing ? (
                      <a
                        href={it.aihotUrl}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        title={it.title}
                        className="block truncate text-white/90 hover:text-accent"
                        style={{ fontSize }}
                      >
                        {it.title}
                      </a>
                    ) : (
                      <span className="block truncate text-white/90" title={it.title} style={{ fontSize }}>
                        {it.title}
                      </span>
                    )}
                  </TileRow>
                ))}
              </ul>
            </section>
          ))}
        />
      )}
    </BigTile>
  )
}
