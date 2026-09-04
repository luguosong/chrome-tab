import { useMemo } from 'react'
import {
  getChangelogSource,
  hasChangelogRaw,
  isLtsVersion,
  isPrereleaseVersion,
  type ChangelogSourceId,
} from 'chrome-tab-shared'
import { useChangelog, useTranslateStatus, useTranslateVersions } from '../hooks/useChangelog'
import { inline } from '../lib/changelogParser'
import DetailModal, { QueryPane } from './DetailModal'

/**
 * 更新日志详情 Modal(ADR-0022,原 ChangelogDrawer 改造:与 AiHotModal/WeatherModal
 * 同范式的居中玻璃面板;检索框随之移除——版本列表纵向滚动即达,入口收窄为 tile 标头
 * 「更多」按钮)。按打开图标的源(source prop,ADR-0020)经 useChangelog 拉取(1h
 * staleTime,与网格图标共享同源 queryKey 缓存),展示完整版本列表(纵向滚动)。
 * 真实 CHANGELOG 无日期、无 ### 小节,条目直接挂在版本下,故按「发布时间线」呈现:
 * 左侧连续细轨 + 每版本一个节点,最新版 accent 高亮 + 「最新」药丸,旧版弱化;每版本
 * 日期 = 后端 releaseTimes 全表(ADR-0022)绝对日期,失败/错位降级不显示。
 * 未译版本(不在 translatedVersions 内)显示「翻译」按钮 → POST /translate 按需补译,
 * 译毕后端持久化、invalidate 重拉即变中文(ADR-0017)。pending 期间轮询译制阶段
 * (GET /translate/status):按钮显「译中 Ns…/排队中…」,hover 显当前候选模型——
 * LLM 分钟级慢与互斥链排队不再表现为「卡死」。
 *
 * 刷新失败降级(spec user story 15):query error 非空 → 显示重试按钮,点击重拉。
 *
 * 容器:详情 Modal 骨架(ADR-0040;错误态重试块走 QueryPane 零件;scroll=false,
 * 版本列表自滚)。编辑态进入时由父组件(DashboardPage)onClose。
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
  // 无原文源(两地址皆缺省,现无实例):版本流为 npm 合成空块,无条目无译制,
  // 每版本行给 GitHub 外链代替,「翻译」按钮不渲染。判别轴 = shared 的
  // hasChangelogRaw(ADR-0050,直取 changelogUrl 或合成 githubReleasesApiUrl 皆算)。
  const noRaw = !hasChangelogRaw(def)
  const { data, isError, refetch } = useChangelog(source)
  const translateMut = useTranslateVersions(source)
  // 译制可观察:pending 期间轮询后端阶段;translating 显模型/耗时,idle 即排队(互斥链)
  const phaseQ = useTranslateStatus(source, translateMut.isPending)
  const ph = phaseQ.data
  const translating = ph?.status === 'translating'
  const elapsedSec =
    translating && ph.since ? Math.max(0, Math.round((Date.now() - Date.parse(ph.since)) / 1000)) : null
  // pending 按钮的双视图(label 显眼/title 详情),提前算好消嵌套三元重复
  const pendingLabel = translating ? `译中 ${elapsedSec ?? 0}s…` : '排队中…'
  const pendingHint = translating
    ? `正在调用 ${ph?.model}(候选 ${ph?.attempt}/${ph?.total})`
    : '排队中——后台刷新/译制任务执行中,完成后自动开始'

  const versions = data?.versions ?? []
  const times = data?.releaseTimes ?? {}
  // 「最新」= 最新稳定版(与块内滚动榜同轴,ADR-0050):全览位列表含预发布占位行,但
  // accent/药丸不给 alpha——同一源对「最新」只给一个答案
  const latest = versions.find((v) => !isPrereleaseVersion(v.title))?.title
  const translated = useMemo(() => new Set(data?.translatedVersions ?? []), [data?.translatedVersions])

  // 译制失败感知:后端译制失败仅记日志、保持英文仍返 200(如 LLM 网关不可达),
  // 请求版本不在响应 translatedVersions 内即失败——据此提示,而非「按钮一闪」无感知。
  // pending 期间 data 是上次的旧值,须排除以免新旧 variables/data 错配误报。
  const translateFailed = useMemo(() => {
    if (translateMut.isPending || !translateMut.data || !translateMut.variables) return []
    const done = new Set(translateMut.data.translatedVersions)
    return translateMut.variables.filter((v) => !done.has(v))
  }, [translateMut.isPending, translateMut.data, translateMut.variables])

  return (
    <DetailModal
      onClose={onClose}
      ariaLabel={`${sourceLabel} 更新日志`}
      scroll={false}
      className="pb-4"
    >
      {/* 顶栏:标题 + 副标题(关闭钮归骨架右上角)。标头不走骨架 title/subtitle——
          本域是「壳不 p-6、区块自拆 padding」三形态之一(ModalShell 注释点名的
          未竟事项),标头 px-6 pt-4 的特例形态随域,骨架深度止于状态机零件。 */}
        <div className="flex items-start px-6 pt-4 pb-2">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-white/90">{sourceLabel} 更新日志</h2>
            {/* 副标题三分对齐(:107 同病同修):数据未到才「加载中」;有版本无正式版
                (全预发布,latest 为 undefined)如实报数、不再永显加载中 */}
            <p className="mt-0.5 text-xs text-white/50">
              {data === undefined
                ? '加载中…'
                : latest
                  ? `共 ${versions.length} 个版本 · 最新 ${latest}`
                  : `共 ${versions.length} 个版本`}
            </p>
          </div>
        </div>

        {/* 失败态 + 列表 */}
        <div className="px-6">
          {isError ? (
            <QueryPane state={{ kind: 'error', message: '日志刷新失败' }} onRetry={() => void refetch()} />
          ) : (
            <>
              {(translateMut.isError || translateFailed.length > 0) && (
                <p className="mb-1.5 text-xs text-red-300/90">
                  {translateMut.isError
                    ? '翻译请求失败，请稍后重试'
                    : `${translateFailed.join('、')} 翻译失败，已保留英文（译制服务暂不可用）`}
                </p>
              )}

              <div className="modal-scroll max-h-[60vh] overflow-auto pr-1.5">
                {/* 加载/空三分(CONTEXT.md「详情 Modal 骨架」状态机):「取到过但为空」
                    可达——无原文源版本流取 npm 表剔除预发布,纯预发布包剔后即空;
                    曾把空混进加载态永显「加载中」(2026-09-02 修) */}
                {data === undefined && <QueryPane state={{ kind: 'loading' }} />}
                {data !== undefined && versions.length === 0 && (
                  <QueryPane state={{ kind: 'empty', message: '该源暂无版本' }} />
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
                              'font-mono text-sm ' +
                              (isLatest ? 'text-accent font-semibold' : 'text-white/75')
                            }
                            dangerouslySetInnerHTML={{ __html: inline(v.title) }}
                          />
                          {date && <span className="font-mono text-meta text-white/40">{date}</span>}
                          {isLatest && (
                            <span className="rounded-full bg-accent/20 px-2 py-0.5 text-meta font-medium leading-none text-accent">
                              最新
                            </span>
                          )}
                          {isLtsVersion(v.title, def) && (
                            <span
                              title={`${def.ltsBranches?.join('/')} 长期支持分支`}
                              className="rounded-full border border-white/25 px-2 py-0.5 text-meta leading-none text-white/55"
                            >
                              LTS
                            </span>
                          )}
                          {noRaw && (
                            <a
                              href={def.releasesUrl}
                              target="_blank"
                              rel="noreferrer"
                              title="GitHub Releases(新标签页打开)"
                              className="rounded-full border border-white/25 px-2.5 py-1 text-meta leading-none text-white/60 hover:border-accent hover:text-accent transition-colors focus-visible:outline-2 focus-visible:outline-white/60"
                            >
                              GitHub ↗
                            </a>
                          )}
                          {/* 无可渲染条目(如合成源的预发布占位块)不给翻译按钮——可渲染性以
                              本组件的 groups 结构为准,与后端 hasEntries(有条目 = 小节标题或 bullet,
                              ADR-0050 §5⑤)同语义,此处为结构形态 */}
                          {!noRaw && groups.length > 0 && !translated.has(v.title) && (
                            <button
                              type="button"
                              disabled={translateMut.isPending}
                              onClick={() => translateMut.mutate([v.title])}
                              title={translateMut.isPending ? pendingHint : '机器翻译此版本(译后持久化)'}
                              className="rounded-full border border-white/25 px-2.5 py-1 text-meta leading-none text-white/60 hover:border-accent hover:text-accent disabled:opacity-50 transition-colors focus-visible:outline-2 focus-visible:outline-white/60"
                            >
                              {translateMut.isPending ? pendingLabel : '翻译'}
                            </button>
                          )}
                        </div>
                        {groups.map((g, j) => (
                          <div key={j} className="mt-1.5">
                            {g.name && (
                              <div
                                className="mb-0.5 text-xs font-medium text-white/80"
                                dangerouslySetInnerHTML={{ __html: inline(g.name) }}
                              />
                            )}
                            <ul className="space-y-1">
                              {g.items.map((it, k) => (
                                <li key={k} className="flex gap-2 text-sm text-white/70">
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
    </DetailModal>
  )
}
