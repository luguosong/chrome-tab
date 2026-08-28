import { useState } from 'react'
import { NEWS_SOURCES, newsSourceLabel } from 'chrome-tab-shared'
import type { NewsSourceId } from 'chrome-tab-shared'
import { useNewsFeed, useSetNewsSources } from '../hooks/useNews'
import { normalizeTab, paneState } from '../lib/detailModalState'
import { timeAgo } from '../lib/timeAgo'
import DetailModal, { retryButtonClass } from './DetailModal'

/** 新条目红点窗口(与 NewsIconBody 同口径)。 */
const NEW_WINDOW_S = 24 * 60 * 60

/**
 * 新闻详情 Modal(见 CONTEXT.md「新闻」):tab = 全部(默认,混合流)→ 各勾选源 →
 * 管理。条目行 = 标题两行截断 + 源名·相对时间(无时间条目省缺),24h 红点仅限有
 * 时间条目,整条外跳原文。管理 tab = 15 源平铺复选清单(failing 标红注记),勾选
 * 即整份提交(改即保存,对齐布局设置哲学;新勾源由后端异步首取)。容器:详情
 * Modal 骨架(ADR-0040;tab 悬空回落与查询状态机由骨架持有,管理 tab 主体自持
 * ——不依赖 feed 数据,失败仍可达)。
 */
type Tab = 'all' | `src-${NewsSourceId}` | 'manage'

export default function NewsModal({ onClose }: { onClose: () => void }) {
  const feed = useNewsFeed()
  const [tab, setTab] = useState<Tab>('all')

  const items = feed.data?.items ?? []
  const sources = feed.data?.sources ?? []
  const tabs: Array<{ key: Tab; label: string }> = [
    { key: 'all', label: '全部' },
    ...sources.map((s) => ({ key: `src-${s.id}` as Tab, label: newsSourceLabel(s.id) })),
    { key: 'manage', label: '管理' },
  ]
  const active = normalizeTab(tabs, tab)
  const shown = active === 'all' ? items : items.filter((i) => `src-${i.source}` === active)

  return (
    <DetailModal
      onClose={onClose}
      ariaLabel="新闻"
      title="新闻"
      className="p-6"
      refresh={() => void feed.refetch()}
      busy={feed.isFetching}
      tabs={tabs}
      tab={active}
      onTabChange={setTab}
      onOpen={() => void feed.refetch()}
      pane={
        active === 'manage'
          ? null
          : paneState({
              isError: feed.isError,
              isPending: feed.isPending,
              isEmpty: shown.length === 0,
              emptyMessage:
                sources.length === 0 ? '还没有勾选新闻源——去「管理」挑选来源' : '这个源还没有条目',
              errorMessage: '新闻流刷新失败',
            })
      }
    >
      {active === 'manage' ? (
        <ManagePane />
      ) : (
        <ul className="space-y-1">
          {shown.map((n) => (
            <li key={n.id}>
              <a
                href={n.url}
                target="_blank"
                rel="noreferrer"
                className="block rounded-xl p-2 hover:bg-white/10 transition-colors"
              >
                <span className="flex items-start gap-1.5">
                  {n.publishedAt !== null && Date.now() / 1000 - n.publishedAt < NEW_WINDOW_S && (
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-red-400" aria-hidden="true" />
                  )}
                  {/* 译文主行,悬停 title 属性恒英文原文供核对(ADR-0029) */}
                  <span className="text-sm text-white/90 line-clamp-2 break-all" title={n.title}>
                    {n.titleZh ?? n.title}
                  </span>
                </span>
                <span className="mt-0.5 block text-xs text-white/45">
                  {newsSourceLabel(n.source)}
                  {n.publishedAt !== null && ` · ${timeAgo(new Date(n.publishedAt * 1000).toISOString())}`}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </DetailModal>
  )
}

/** 管理 tab:15 源平铺复选清单(勾选即整份提交;failing 标红;抓取时间提示)。 */
function ManagePane() {
  const feed = useNewsFeed()
  const setSources = useSetNewsSources()
  // 勾选集未加载(data undefined)时禁止渲染清单:PUT 是整份替换,空集误提交会
  // 把已有勾选全部抹掉(code-review)——宁可禁用也别让一次误点清空选择
  if (feed.data === undefined) {
    return (
      <div className="py-6 text-center text-sm text-white/50">
        {feed.isError ? '勾选集加载失败——' : '勾选集加载中…'}
        <button
          type="button"
          onClick={() => void feed.refetch()}
          disabled={feed.isFetching}
          className={'ml-2 ' + retryButtonClass}
        >
          重试
        </button>
      </div>
    )
  }
  const sources = feed.data.sources
  const checked = new Set(sources.map((s) => s.id))
  const stateOf = (id: NewsSourceId) => sources.find((s) => s.id === id)

  const toggle = (id: NewsSourceId, on: boolean) => {
    if (setSources.isPending) return
    const next = NEWS_SOURCES.map((s) => s.id).filter((sid) => (sid === id ? on : checked.has(sid)))
    setSources.mutate(next)
  }

  return (
    <div className="space-y-1">
      <p className="pb-2 text-xs text-white/45">
        勾选要跟踪的新闻源(改动即时保存,新勾源由后台抓取,稍后见效)
      </p>
      <ul>
        {NEWS_SOURCES.map(({ id, label }) => {
          const st = stateOf(id)
          return (
            <li key={id} className="rounded-xl px-2 py-1.5 hover:bg-white/5">
              <label className="flex cursor-pointer items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={checked.has(id)}
                  disabled={setSources.isPending}
                  onChange={(e) => toggle(id, e.target.checked)}
                  className="h-4 w-4 accent-[var(--accent)]"
                />
                <span className="min-w-0 flex-1 text-sm text-white/90">{label}</span>
                {st && (
                  <span
                    className={
                      'shrink-0 text-xs ' + (st.status === 'failing' ? 'text-red-300' : 'text-white/40')
                    }
                    title={st.lastSuccessAt ? `最近抓取 ${timeAgo(st.lastSuccessAt)}` : undefined}
                  >
                    {st.status === 'failing'
                      ? '取数失败'
                      : st.lastSuccessAt
                        ? timeAgo(st.lastSuccessAt)
                        : '抓取中…'}
                  </span>
                )}
              </label>
            </li>
          )
        })}
      </ul>
      {setSources.isError && (
        <p className="pt-2 text-xs text-red-300">
          保存失败:{setSources.error instanceof Error ? setSources.error.message : '网络异常'}
          ,勾选已还原,请重试
        </p>
      )}
    </div>
  )
}
