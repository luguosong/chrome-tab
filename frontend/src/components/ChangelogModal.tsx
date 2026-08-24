import { useEffect, useMemo } from 'react'
import { getChangelogSource, type ChangelogSourceId } from 'chrome-tab-shared'
import { useChangelog, useTranslateVersions } from '../hooks/useChangelog'
import { inline } from '../lib/changelogParser'

/**
 * 更新日志详情 Modal(ADR-0022,原 ChangelogDrawer 改造:与 AiHotModal/WeatherModal
 * 同范式的居中玻璃面板;检索框随之移除——版本列表纵向滚动即达,入口收窄为 tile 标头
 * 「更多」按钮)。按打开图标的源(source prop,ADR-0020)经 useChangelog 拉取(1h
 * staleTime,与网格图标共享同源 queryKey 缓存),展示完整版本列表(纵向滚动)。
 * 真实 CHANGELOG 无日期、无 ### 小节,条目直接挂在版本下,故按「发布时间线」呈现:
 * 左侧连续细轨 + 每版本一个节点,最新版 accent 高亮 + 「最新」药丸,旧版弱化;每版本
 * 日期 = npm releaseTimes 全表(ADR-0022)绝对日期,失败/错位降级不显示。
 * 未译版本(不在 translatedVersions 内)显示「翻译」按钮 → POST /translate 按需补译,
 * 译毕后端持久化、invalidate 重拉即变中文(ADR-0017)。
 *
 * 刷新失败降级(spec user story 15):query error 非空 → 显示重试按钮,点击重拉。
 *
 * 容器:fixed 居中、玻璃面板、关闭按钮;Esc / 点遮罩关闭。入场:fade-in 遮罩 + pop-in
 * 面板(reduced-motion 下不动画)。编辑态进入时由父组件(DashboardPage)onClose。
 */
export default function ChangelogModal({
  source,
  onClose,
}: {
  source: ChangelogSourceId
  onClose: () => void
}) {
  const def = getChangelogSource(source)
  const sourceLabel = def.label
  // 无原文源(如 Codex,changelogUrl 缺省):版本流为 npm 合成空块,无条目无译制,
  // 每版本行给 GitHub 外链代替,「翻译」按钮不渲染。
  const noRaw = !def.changelogUrl
  const { data, isError, refetch } = useChangelog(source)
  const translateMut = useTranslateVersions(source)

  const versions = data?.versions ?? []
  const times = data?.releaseTimes ?? {}
  const latest = versions[0]?.title
  const translated = useMemo(() => new Set(data?.translatedVersions ?? []), [data?.translatedVersions])

  // 译制失败感知:后端译制失败仅记日志、保持英文仍返 200(如 LLM 网关不可达),
  // 请求版本不在响应 translatedVersions 内即失败——据此提示,而非「按钮一闪」无感知。
  // pending 期间 data 是上次的旧值,须排除以免新旧 variables/data 错配误报。
  const translateFailed = useMemo(() => {
    if (translateMut.isPending || !translateMut.data || !translateMut.variables) return []
    const done = new Set(translateMut.data.translatedVersions)
    return translateMut.variables.filter((v) => !done.has(v))
  }, [translateMut.isPending, translateMut.data, translateMut.variables])

  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label={`${sourceLabel} 更新日志`}
    >
      {/* 遮罩:点击关闭 */}
      <div className="absolute inset-0 bg-black/50 animate-fade-in" onClick={onClose} />

      <div className="glass-panel glass-panel-readable relative w-full max-w-2xl rounded-3xl pb-4 animate-pop-in">
        {/* 顶栏:标题 + 副标题 + 关闭 */}
        <div className="flex items-start justify-between px-6 pt-4 pb-2">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-white/90">{sourceLabel} 更新日志</h2>
            <p className="mt-0.5 text-xs text-white/50">
              {latest ? `共 ${versions.length} 个版本 · 最新 ${latest}` : '加载中…'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="ml-3 shrink-0 w-8 h-8 rounded-full bg-white/20 text-white/80 hover:bg-white/40 flex items-center justify-center transition-colors"
          >
            ×
          </button>
        </div>

        {/* 失败态 + 列表 */}
        <div className="px-6">
          {isError ? (
            <div className="flex items-center gap-3 py-6">
              <span className="text-sm text-white/60">日志刷新失败</span>
              <button
                type="button"
                onClick={() => void refetch()}
                className="border border-white/30 text-white/80 rounded-md px-2 py-0.5 text-xs hover:border-accent hover:text-accent"
              >
                重试
              </button>
            </div>
          ) : (
            <>
              {(translateMut.isError || translateFailed.length > 0) && (
                <p className="mb-1.5 text-xs text-red-300/90">
                  {translateMut.isError
                    ? '翻译请求失败，请稍后重试'
                    : `${translateFailed.join('、')} 翻译失败，已保留英文（译制服务暂不可用）`}
                </p>
              )}

              <div className="max-h-[60vh] overflow-auto pr-1.5">
                {versions.length === 0 && (
                  <div className="text-white/60 text-sm py-4">加载中…</div>
                )}

                {noRaw && versions.length > 0 && (
                  <p className="mb-2 text-xs text-white/40">
                    上游无逐版更新说明正文,详情走每版本行的 GitHub 外链。
                  </p>
                )}

                <ol className="relative pl-6 [&_a]:text-accent [&_a]:underline">
                  {/* 时间线左轨 */}
                  <span
                    className="absolute left-[8px] top-0 bottom-0 w-px bg-white/15"
                    aria-hidden="true"
                  />
                  {versions.map((v, i) => {
                    const isLatest = !!latest && v.title === latest
                    // top(无小节条目)在前;命名小节(若未来出现)按名渲染
                    const groups: { name?: string; items: string[] }[] = []
                    if (v.top.length) groups.push({ items: v.top })
                    for (const s of v.sections) groups.push({ name: s.name, items: s.items })
                    const date = times[v.title]?.slice(0, 10)
                    return (
                      <li key={i} className="relative mb-4 last:mb-0">
                        {/* 时间线节点:最新版实心 accent,旧版弱化 */}
                        <span
                          className={
                            'absolute -left-[19px] top-[7px] h-1.5 w-1.5 rounded-full ' +
                            (isLatest ? 'bg-accent' : 'bg-white/35')
                          }
                          aria-hidden="true"
                        />
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3
                            className={
                              'font-mono text-[15px] ' +
                              (isLatest ? 'text-accent font-semibold' : 'text-white/75')
                            }
                            dangerouslySetInnerHTML={{ __html: inline(v.title) }}
                          />
                          {date && <span className="font-mono text-[11px] text-white/40">{date}</span>}
                          {isLatest && (
                            <span className="rounded-full bg-accent/20 px-2 py-0.5 text-[10px] font-medium leading-none text-accent">
                              最新
                            </span>
                          )}
                          {noRaw && (
                            <a
                              href={def.releasesUrl}
                              target="_blank"
                              rel="noreferrer"
                              title="GitHub Releases(新标签页打开)"
                              className="rounded-full border border-white/25 px-2 py-0.5 text-[10px] leading-none text-white/60 hover:border-accent hover:text-accent transition-colors"
                            >
                              GitHub ↗
                            </a>
                          )}
                          {!noRaw && !translated.has(v.title) && (
                            <button
                              type="button"
                              disabled={translateMut.isPending}
                              onClick={() => translateMut.mutate([v.title])}
                              title="机器翻译此版本(译后持久化)"
                              className="rounded-full border border-white/25 px-2 py-0.5 text-[10px] leading-none text-white/60 hover:border-accent hover:text-accent disabled:opacity-50 transition-colors"
                            >
                              {translateMut.isPending ? '译中…' : '翻译'}
                            </button>
                          )}
                        </div>
                        {groups.map((g, j) => (
                          <div key={j} className="mt-1.5">
                            {g.name && (
                              <div
                                className="mb-0.5 text-[12px] font-medium text-white/80"
                                dangerouslySetInnerHTML={{ __html: inline(g.name) }}
                              />
                            )}
                            <ul className="space-y-1">
                              {g.items.map((it, k) => (
                                <li key={k} className="flex gap-2 text-[13px] text-white/70">
                                  <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-white/40" />
                                  <span
                                    className="min-w-0"
                                    dangerouslySetInnerHTML={{ __html: inline(it) }}
                                  />
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </li>
                    )
                  })}
                </ol>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
