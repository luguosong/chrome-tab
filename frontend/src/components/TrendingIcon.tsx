import { DEFAULT_TRENDING_QUERY, useKnownSet, useTrending } from '../hooks/useTrending'
import { ICON_SCALE, tileFont } from '../lib/iconLayout'
import type { Icon } from '../lib/types'
import BigTile from './BigTile'
import { KnownCheck, TileBody, TileRowLink } from './TileBody'

/**
 * GitHub 趋势图标的专属网格渲染(见 CONTEXT.md「GitHub 趋势」;3×2 大 tile,
 * ADR-0021/0022 范式):外壳/标头走 BigTile(标头名直达 github.com/trending,
 * 鲜度 = 缓存抓取时刻),主体 = **Today 趋势**单列滚动榜(块内主体骨架走 TileBody,
 * 见 CONTEXT.md「块内主体」;行 = 语言色点 + repo 名 + 右侧周期内 star 增量,
 * 点行外跳仓库页 = TileRowLink 外链臂;趋势行无红点——周期增量自带时间感)。
 * 数据自持 useTrending 默认组合(后端 cron 1h 保热该组合,ADR-0028)。
 */
export default function TrendingIconBody({
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
  const { data, isError } = useTrending(DEFAULT_TRENDING_QUERY)
  const knownSet = useKnownSet()
  const fontSize = tileFont(ICON_SCALE, 'secondary')
  const repos = data?.repos ?? []

  return (
    <BigTile
      title="GitHub 趋势"
      titleHref="https://github.com/trending"
      titleLinkHint="打开 GitHub Trending 页"
      fresh={data?.fetchedAt ?? null}
      onOpenDetail={onOpenDetail}
      moreTitle="查看趋势仓库与筛选"
      overlay={overlay}
    >
      {isError ? (
        // 取数失败显式降级(同 NewsIcon 口径):恒在场 tile 不静默空白
        <div className="flex-1 flex items-center justify-center text-white/40" style={{ fontSize }}>
          趋势榜刷新失败
        </div>
      ) : repos.length === 0 ? (
        // 启动预热未完/首取进行中(后端无缓存时现抓 ~2.4s,ADR-0027 实测口径)
        <div className="flex-1 flex items-center justify-center text-white/40" style={{ fontSize }}>
          正在抓取趋势榜…
        </div>
      ) : (
        <TileBody
          rows={repos.map((r) => (
            <TileRowLink
              key={r.repo}
              href={r.url}
              title={
                (r.descriptionZh ?? r.description) ? `${r.repo} — ${r.descriptionZh ?? r.description}` : r.repo
              }
              marked={knownSet.has(r.repo)}
              className="flex min-w-0 items-center justify-between gap-2"
            >
              <span className="flex min-w-0 items-center gap-1.5">
                {r.languageColor && (
                  // 语言色点:与 Modal 胶囊/行内同色互证(GitHub linguist 行内色同源)
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: r.languageColor }}
                    aria-hidden="true"
                  />
                )}
                <span className="min-w-0 truncate text-white/90" style={{ fontSize }}>
                  {r.repo}
                </span>
                {knownSet.has(r.repo) && (
                  // 已了解勾标(块内只读;手势唯一入口在 Modal,CONTEXT.md「已了解」)
                  <KnownCheck className="h-3 w-3 shrink-0 text-emerald-300" />
                )}
              </span>
              <span className="shrink-0 font-mono text-white/45" style={{ fontSize }}>
                +{r.periodStars.toLocaleString('en-US')}
              </span>
            </TileRowLink>
          ))}
        />
      )}
    </BigTile>
  )
}
