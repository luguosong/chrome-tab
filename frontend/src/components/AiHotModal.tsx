import { useState } from 'react'
import { useAiHot, useAiHotDaily, useAiHotModelPicks } from '../hooks/useAiHot'
import { formatDailyDate } from '../lib/aihot'
import { timeAgo } from '../lib/timeAgo'
import { extractString } from '../lib/iconData'
import { paneState } from '../lib/detailModalState'
import type { Icon } from '../lib/types'
import DetailModal, { QueryPane } from './DetailModal'

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
 * queryKey 去重);失败(null / isError)→ 面板内错误态重试。容器:详情 Modal
 * 骨架(ADR-0040;三 tab 各持查询态——热点走骨架 pane,精选/日报面板走
 * QueryPane 零件,不为此 1/10 成员撑宽复合出口,ADR-0038 §6)。
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
  // 「从未取到」(200-null)已在 queryFn 归一为 error(ADR-0049),失败判定只剩 isError
  const failed = isError
  const topics = data ?? []

  return (
    <DetailModal
      onClose={onClose}
      ariaLabel="AI 热点"
      width="lg"
      className="p-6"
      title={extractString(icon.data, 'name') || 'AI 热点'}
      subtitle="AIHOT 事件热点榜 + 模型精选 + AI 日报"
      tabs={TABS}
      tab={tab}
      onTabChange={setTab}
      busy={isFetching}
      pane={
        tab === 'hot'
          ? paneState({
              isError: failed,
              isPending: data === undefined,
              isEmpty: topics.length === 0,
              emptyMessage: '当前没有热点',
              errorMessage: '热点刷新失败',
            })
          : null
      }
      onRetry={() => void refetch()}
    >
      {tab === 'hot' ? (
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
                <div className="text-meta text-white/50 mt-1 flex items-center gap-2 flex-wrap">
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
      ) : tab === 'picks' ? (
        <ModelPicksPanel />
      ) : (
        <DailyPanel />
      )}
    </DetailModal>
  )
}

/** 模型精选 tab 面板:懒挂载(只在选中时渲染),三态走 QueryPane 零件(ADR-0040)。 */
function ModelPicksPanel() {
  const { data, isError, refetch, isFetching } = useAiHotModelPicks()
  const failed = isError
  const picks = data ?? []

  return (
    <QueryPane
      state={paneState({
        isError: failed,
        isPending: data === undefined,
        isEmpty: picks.length === 0,
        emptyMessage: '近 7 天没有模型精选',
        errorMessage: '精选刷新失败',
      })}
      onRetry={() => void refetch()}
      retryBusy={isFetching}
    >
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
            <div className="text-meta text-white/50 mt-1 flex items-center gap-2 flex-wrap">
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
    </QueryPane>
  )
}

/**
 * 日报 tab 面板:懒挂载(只在选中时渲染),三态走 QueryPane 零件;出刊前(空
 * sections)按空态而非失败处理。条目无 id,key 用 section/条目双下标——定稿
 * 快照渲染期不重排,安全(见 lib/aihot.ts 类型注释)。
 */
function DailyPanel() {
  const { data, isError, refetch, isFetching } = useAiHotDaily()
  const failed = isError
  const sections = data?.sections.filter((s) => s.items.length > 0) ?? []
  const total = sections.reduce((n, s) => n + s.items.length, 0)

  return (
    <QueryPane
      state={paneState({
        isError: failed,
        isPending: data === undefined,
        isEmpty: sections.length === 0,
        emptyMessage: '今日日报还未出刊(每早 8:00)',
        errorMessage: '日报刷新失败',
      })}
      onRetry={() => void refetch()}
      retryBusy={isFetching}
    >
      <div>
        <div className="text-sm text-white/80 mb-2">
          {data?.date && (
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
                  <div className="text-meta text-white/50 mt-1 flex items-center gap-2 flex-wrap">
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
                    <p className="text-sm text-white/60 leading-relaxed mt-1.5">{it.summary}</p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </QueryPane>
  )
}
