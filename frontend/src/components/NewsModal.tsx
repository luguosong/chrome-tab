import { useEffect, useState } from 'react'
import { NEWS_SOURCES, newsSourceLabel } from 'chrome-tab-shared'
import type { NewsSourceId } from 'chrome-tab-shared'
import { useNewsFeed, useSetNewsSources } from '../hooks/useNews'
import { timeAgo } from '../lib/timeAgo'
import ModalShell from './ModalShell'

/** 新条目红点窗口(与 NewsIconBody 同口径)。 */
const NEW_WINDOW_S = 24 * 60 * 60

/**
 * 新闻详情 Modal(见 CONTEXT.md「新闻」):tab = 全部(默认,混合流)→ 各勾选源 →
 * 管理。条目行 = 标题两行截断 + 源名·相对时间(无时间条目省缺),24h 红点仅限有
 * 时间条目,整条外跳原文。管理 tab = 15 源平铺复选清单(failing 标红注记),勾选
 * 即整份提交(改即保存,对齐布局设置哲学;新勾源由后端异步首取)。容器:
 * ModalShell 统一壳(ADR-0031)。
 */
type Tab = 'all' | `src-${NewsSourceId}` | 'manage'

export default function NewsModal({ onClose }: { onClose: () => void }) {
  const feed = useNewsFeed()
  const [tab, setTab] = useState<Tab>('all')

  // 打开即对账最新(勾选源首取可能刚完成);refetch 引用稳定,空依赖安全
  useEffect(() => {
    void feed.refetch()
  }, [])

  const items = feed.data?.items ?? []
  const sources = feed.data?.sources ?? []
  const tabs: Array<{ key: Tab; label: string }> = [
    { key: 'all', label: '全部' },
    ...sources.map((s) => ({ key: `src-${s.id}` as Tab, label: newsSourceLabel(s.id) })),
    { key: 'manage', label: '管理' },
  ]
  // 勾选收缩后当前 tab 可能悬空(源被取消勾选)→ 回落「全部」
  const active =
    tab === 'all' || tab === 'manage' || sources.some((s) => `src-${s.id}` === tab)
      ? tab
      : 'all'
  const shown = active === 'all' ? items : items.filter((i) => `src-${i.source}` === active)

  return (
    <ModalShell onClose={onClose} ariaLabel="新闻" className="p-6">

      <div className="mb-3 flex items-center gap-2">
          <h2 className="text-lg font-semibold text-white/90">新闻</h2>
          <button
            type="button"
            onClick={() => void feed.refetch()}
            disabled={feed.isFetching}
            aria-label="刷新"
            title="刷新"
            className="w-6 h-6 rounded-full bg-white/20 text-white/80 hover:bg-white/40 focus-visible:outline-2 focus-visible:outline-white/60 flex items-center justify-center text-sm disabled:opacity-50"
          >
            <span className={feed.isFetching ? 'animate-spin inline-block' : 'inline-block'}>↻</span>
          </button>
        </div>

        {/* tab 按钮不可加 -mb-px 压线:overflow-x-auto 会把 overflow-y 计算为 auto,1px 溢出即冒垂直滚动条。
            横条走 modal-scroll 雾胶囊(与面板同语汇,占位 8px 随行盒长高、下划线与分隔线同盒不脱开)——
            17 个 tab 常态溢出,横滚是主交互,藏条(eee92a5f 曾走 no-scrollbar)会失去拖拽与可滚提示 */}
        <div role="tablist" aria-label="新闻视图" className="flex gap-4 border-b border-white/10 mb-3 overflow-x-auto modal-scroll">
          {tabs.map(({ key, label }) => (
            <button
              key={key}
              role="tab"
              aria-selected={active === key}
              type="button"
              onClick={() => setTab(key)}
              className={
                'pb-1.5 text-sm border-b-2 whitespace-nowrap transition focus-visible:outline-2 focus-visible:outline-white/60 ' +
                (active === key
                  ? 'text-accent border-accent'
                  : 'text-white/60 border-transparent hover:text-white/85')
              }
            >
              {label}
            </button>
          ))}
        </div>

        {active === 'manage' ? (
          // 管理不依赖 feed 数据(勾选集加载失败时条目流只是不可看,勾选管理仍须可达)
          <ManagePane />
        ) : feed.isError ? (
          <div className="flex items-center gap-3 py-4">
            <span className="text-sm text-white/60">新闻流刷新失败</span>
            <button
              type="button"
              onClick={() => void feed.refetch()}
              disabled={feed.isFetching}
              className="border border-white/30 text-white/80 rounded-md px-2 py-0.5 text-xs hover:border-accent hover:text-accent disabled:opacity-50"
            >
              重试
            </button>
          </div>
        ) : shown.length === 0 ? (
          <div className="text-sm text-white/50 py-6 text-center">
            {sources.length === 0 ? '还没有勾选新闻源——去「管理」挑选来源' : '这个源还没有条目'}
          </div>
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
    </ModalShell>
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
          className="ml-2 border border-white/30 text-white/80 rounded-md px-2 py-0.5 text-xs hover:border-accent hover:text-accent disabled:opacity-50"
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
