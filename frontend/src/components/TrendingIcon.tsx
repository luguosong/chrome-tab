import { DEFAULT_TRENDING_QUERY, useTrending } from '../hooks/useTrending'
import { ICON_SCALE, tileFont } from '../lib/iconLayout'
import type { Icon } from '../lib/types'
import BigTile from './BigTile'

/** 榜单最多渲染行数(对齐 ADR-0022 changelog/video/model/news 30 行先例,看全部走 Modal)。 */
const MAX_ROWS = 30

/**
 * GitHub 趋势图标的专属网格渲染(见 CONTEXT.md「GitHub 趋势」;3×2 大 tile,
 * ADR-0021/0022 范式):外壳/标头走 BigTile(标头名直达 github.com/trending,
 * 鲜度 = 缓存抓取时刻),主体 = **Today 趋势**单列滚动榜(行 = 语言色点 + repo 名 +
 * 右侧周期内 star 增量,点行外跳仓库页)。数据自持 useTrending 默认组合(后端 cron
 * 1h 保热该组合,ADR-0028)。
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
        <ol
          // 原生滚动翻阅(tile-scroll;触屏 pan-y,TouchSensor 分流拖拽;同 aihot/todo/video/model/news)
          className="flex-1 min-h-0 overflow-y-auto flex flex-col px-2 py-1.5 tile-scroll [touch-action:pan-y]"
        >
          {repos.slice(0, MAX_ROWS).map((r) => (
            <li key={r.repo} className="min-w-0">
              <a
                href={r.url}
                target="_blank"
                rel="noreferrer"
                title={(r.descriptionZh ?? r.description) ? `${r.repo} — ${r.descriptionZh ?? r.description}` : r.repo}
                className="flex min-w-0 items-center justify-between gap-2 rounded-lg px-2 py-1 hover:bg-white/10 transition-colors"
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
                </span>
                <span className="shrink-0 font-mono text-white/45" style={{ fontSize }}>
                  +{r.periodStars.toLocaleString('en-US')}
                </span>
              </a>
            </li>
          ))}
        </ol>
      )}
    </BigTile>
  )
}
