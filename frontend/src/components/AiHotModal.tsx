import { useEffect, useState } from 'react'
import { useAiHot, useAiHotDaily, useAiHotModelPicks } from '../hooks/useAiHot'
import { formatDailyDate } from '../lib/aihot'
import { timeAgo } from '../lib/timeAgo'
import { extractString } from '../lib/iconData'
import type { Icon } from '../lib/types'

/**
 * AI 热点详情 Modal(见 CONTEXT.md「AI 热点」,与天气同范式的详情容器),三 tab:
 *  - 日报(默认,2026-08-25 随块内改日报):每早八时定稿的带日期快照
 *    (CONTEXT.md「AI 日报」),日期标头 + 五分类分组 + 摘要全显的阅读视图;
 *  - 热点榜:事件级聚合排名流,条目主跳 AIHOT 站内事件页(links.story,
 *    报道时间线 + AI 综述),原文出处(links.original)作次链接直给;
 *  - 模型精选:精选流 ×「模型发布」分类的条目级策展(CONTEXT.md「模型精选」),
 *    主跳 AIHOT 站内阅读页(中文摘要),原文作次链。
 * 模型精选/日报面板懒挂载——切到该 tab 才挂载组件、才发请求;日报取数无轮询
 * (定稿一天一版)。
 * 数据自持 useAiHot / useAiHotModelPicks / useAiHotDaily(图标 body 与热点同
 * queryKey 去重);失败(null / isError)→ 面板内「刷新失败,重试」。容器:fixed
 * 遮罩 + 居中玻璃面板;Esc / 点遮罩关闭(同 WeatherModal;tab 为 TodoModal 同款
 * 下划线式)。
 */
type Tab = 'hot' | 'picks' | 'daily'
const TABS: { key: Tab; label: string }[] = [
  { key: 'hot', label: '热点榜' },
  { key: 'picks', label: '模型精选' },
  { key: 'daily', label: '日报' },
]

export default function AiHotModal({ icon, onClose }: { icon: Icon; onClose: () => void }) {
  const { data, isError, refetch, isFetching } = useAiHot()
  // 默认日报(2026-08-25 起块内即日报,「更多」= 块内内容展开,默认视图随之)
  const [tab, setTab] = useState<Tab>('daily')
  // 失败 = 网络错(isError)或后端从未取到(data===null,HTTP 200);
  // data===undefined 是首次加载中,不算失败(区别于 null,WeatherModal 同款显式加载态)。
  const failed = isError || data === null
  const topics = data ?? []

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="AI 热点"
    >
      <div className="absolute inset-0 bg-black/50 animate-fade-in" onClick={onClose} />

      <div className="glass-panel glass-panel-readable relative w-full max-w-lg rounded-3xl p-6 max-h-[80vh] overflow-y-auto animate-pop-in">
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭"
          className="absolute top-3 right-3 w-8 h-8 rounded-full bg-white/20 text-white/80 hover:bg-white/40 flex items-center justify-center"
        >
          ×
        </button>

        <div className="mb-3">
          <div className="text-lg text-white/90">
            {extractString(icon.data, 'name') || 'AI 热点'}
          </div>
          <div className="text-xs text-white/50">AIHOT 事件热点榜 + 模型精选 + AI 日报</div>
        </div>

        <div role="tablist" aria-label="AI 热点视图" className="flex gap-4 border-b border-white/10 mb-2">
          {TABS.map(({ key, label }) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              type="button"
              onClick={() => setTab(key)}
              className={
                'pb-1.5 -mb-px text-sm border-b-2 transition ' +
                (tab === key
                  ? 'text-accent border-accent'
                  : 'text-white/60 border-transparent hover:text-white/85')
              }
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'hot' ? (
          failed ? (
            <div className="flex items-center gap-3">
              <span className="text-sm text-white/60">热点刷新失败</span>
              <button
                type="button"
                onClick={() => void refetch()}
                disabled={isFetching}
                className="border border-white/30 text-white/80 rounded-md px-2 py-0.5 text-xs hover:border-accent hover:text-accent disabled:opacity-50"
              >
                刷新失败,重试
              </button>
            </div>
          ) : data === undefined ? (
            <div className="text-xs text-white/40 py-6 text-center">加载中…</div>
          ) : topics.length === 0 ? (
            <div className="text-sm text-white/50 py-6 text-center">当前没有热点</div>
          ) : (
            <ol className="space-y-1">
              {topics.map((t) => (
                <li
                  key={t.rank}
                  className="rounded-xl px-3 py-2.5 hover:bg-white/10 transition flex gap-3"
                >
                  <span className="font-mono text-accent text-sm w-5 shrink-0 text-right self-start mt-0.5">
                    {t.rank}
                  </span>
                  <div className="min-w-0 flex-1">
                    {t.storyUrl ? (
                      <a
                        href={t.storyUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm text-white/90 leading-snug hover:text-accent"
                      >
                        {t.title}
                      </a>
                    ) : (
                      <span className="text-sm text-white/90 leading-snug">{t.title}</span>
                    )}
                    <div className="text-[11px] text-white/50 mt-1 flex items-center gap-2 flex-wrap">
                      {t.sourceName && <span className="truncate max-w-[40%]">{t.sourceName}</span>}
                      {t.sourceCount > 1 && <span>{t.sourceCount} 源</span>}
                      {t.latestAt && <span>{timeAgo(t.latestAt)}</span>}
                      {t.originalUrl && (
                        <a
                          href={t.originalUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="underline underline-offset-2 hover:text-accent"
                        >
                          原文
                        </a>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )
        ) : tab === 'picks' ? (
          <ModelPicksPanel />
        ) : (
          <DailyPanel />
        )}
      </div>
    </div>
  )
}

/** 模型精选 tab 面板:懒挂载(只在选中时渲染),三态与热点面板同款。 */
function ModelPicksPanel() {
  const { data, isError, refetch, isFetching } = useAiHotModelPicks()
  const failed = isError || data === null
  const picks = data ?? []

  if (failed) {
    return (
      <div className="flex items-center gap-3">
        <span className="text-sm text-white/60">精选刷新失败</span>
        <button
          type="button"
          onClick={() => void refetch()}
          disabled={isFetching}
          className="border border-white/30 text-white/80 rounded-md px-2 py-0.5 text-xs hover:border-accent hover:text-accent disabled:opacity-50"
        >
          刷新失败,重试
        </button>
      </div>
    )
  }
  if (data === undefined) {
    return <div className="text-xs text-white/40 py-6 text-center">加载中…</div>
  }
  if (picks.length === 0) {
    return <div className="text-sm text-white/50 py-6 text-center">近 7 天没有模型精选</div>
  }
  return (
    <ul className="space-y-1">
      {picks.map((p) => (
        <li key={p.id} className="rounded-xl px-3 py-2.5 hover:bg-white/10 transition">
          {p.aihotUrl ? (
            <a
              href={p.aihotUrl}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-white/90 leading-snug hover:text-accent"
            >
              {p.title}
            </a>
          ) : (
            <span className="text-sm text-white/90 leading-snug">{p.title}</span>
          )}
          <div className="text-[11px] text-white/50 mt-1 flex items-center gap-2 flex-wrap">
            {p.sourceName && <span className="truncate max-w-[40%]">{p.sourceName}</span>}
            {p.publishedAt && <span>{timeAgo(p.publishedAt)}</span>}
            {p.originalUrl && (
              <a
                href={p.originalUrl}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2 hover:text-accent"
              >
                原文
              </a>
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}

/**
 * 日报 tab 面板:懒挂载(只在选中时渲染),三态与热点面板同款;出刊前(空
 * sections)按空态而非失败处理。条目无 id,key 用 section/条目双下标——定稿
 * 快照渲染期不重排,安全(见 lib/aihot.ts 类型注释)。
 */
function DailyPanel() {
  const { data, isError, refetch, isFetching } = useAiHotDaily()
  const failed = isError || data === null

  if (failed) {
    return (
      <div className="flex items-center gap-3">
        <span className="text-sm text-white/60">日报刷新失败</span>
        <button
          type="button"
          onClick={() => void refetch()}
          disabled={isFetching}
          className="border border-white/30 text-white/80 rounded-md px-2 py-0.5 text-xs hover:border-accent hover:text-accent disabled:opacity-50"
        >
          刷新失败,重试
        </button>
      </div>
    )
  }
  if (data === undefined) {
    return <div className="text-xs text-white/40 py-6 text-center">加载中…</div>
  }
  const sections = data.sections.filter((s) => s.items.length > 0)
  if (sections.length === 0) {
    return <div className="text-sm text-white/50 py-6 text-center">今日日报还未出刊(每早 8:00)</div>
  }
  const total = sections.reduce((n, s) => n + s.items.length, 0)
  return (
    <div>
      <div className="text-sm text-white/80 mb-2">
        {data.date && (
          <>
            {formatDailyDate(data.date)}
            <span className="text-white/40"> · </span>
          </>
        )}
        <span className="text-white/40">共 {total} 条</span>
      </div>
      {sections.map((s, si) => (
        <section key={si}>
          <div className="text-xs text-accent/80 mt-3 first:mt-0 mb-1">{s.label}</div>
          <ul className="space-y-1">
            {s.items.map((it, ii) => (
              <li key={ii} className="rounded-xl px-3 py-2.5 hover:bg-white/10 transition">
                {it.aihotUrl ? (
                  <a
                    href={it.aihotUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm text-white/90 leading-snug hover:text-accent"
                  >
                    {it.title}
                  </a>
                ) : (
                  <span className="text-sm text-white/90 leading-snug">{it.title}</span>
                )}
                <div className="text-[11px] text-white/50 mt-1 flex items-center gap-2 flex-wrap">
                  {it.sourceName && <span className="truncate max-w-[40%]">{it.sourceName}</span>}
                  {it.originalUrl && (
                    <a
                      href={it.originalUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="underline underline-offset-2 hover:text-accent"
                    >
                      原文
                    </a>
                  )}
                </div>
                {it.summary && (
                  <p className="text-[13px] text-white/60 leading-relaxed mt-1.5">{it.summary}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
