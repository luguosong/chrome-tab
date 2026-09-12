import { useState } from 'react'
import type { ReactNode } from 'react'
import { useAiHot, useAiHotDaily, useAiHotModelPicks } from '../hooks/useAiHot'
import { formatDailyDate } from '../lib/aihot'
import { timeAgo } from '../lib/timeAgo'
import { decodeIcon } from '../lib/iconTypeRegistry'
import { paneState } from '../lib/detailModalState'
import type { Icon } from '../lib/types'
import DetailModal, { QueryPane } from './DetailModal'
import InfoRow from './InfoRow'

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
      width="2xl"
      className="p-6"
      title={decodeIcon('aihot', icon.data)?.name || 'AI 热点'}
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
            <AiHotRow
              key={t.rank}
              url={t.storyUrl}
              title={t.title}
              leading={
                <span className="font-mono text-accent text-sm w-5 shrink-0 text-right self-start mt-0.5">
                  {t.rank}
                </span>
              }
              meta={
                <>
                  {t.sourceCount > 1 && <span>{t.sourceCount} 源</span>}
                  {t.latestAt && <span>{timeAgo(t.latestAt)}</span>}
                  <AiHotOriginalLink url={t.originalUrl} />
                </>
              }
              source={t.sourceName}
            />
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

/**
 * AI 热点族行壳适配(三面板同构的族内方言):px-3 py-2.5 + active 态覆盖 InfoRow
 * 默认 p-2(轴向前缀类在 Tailwind 样式表中后于 p 简写,追加即覆盖);标题可选
 * 主跳(缺 storyUrl/aihotUrl 时纯文本),次行 = 源名 + 域自持分段。
 */
function AiHotRow({
  url,
  title,
  meta,
  leading,
  source,
  children,
}: {
  url?: string | null
  title: string
  meta?: ReactNode
  leading?: ReactNode
  source?: string | null
  children?: ReactNode
}) {
  return (
    <InfoRow
      className="px-3 py-2.5 active:bg-white/20"
      leading={leading}
      title={
        url ? (
          <a href={url} target="_blank" rel="noreferrer" className="hover:text-accent">
            {title}
          </a>
        ) : (
          title
        )
      }
      meta={
        <div className="text-meta text-white/50 flex items-center gap-2 flex-wrap">
          {source && <span className="truncate max-w-[40%]">{source}</span>}
          {meta}
        </div>
      }
    >
      {children}
    </InfoRow>
  )
}

/** 原文次链(热点榜/精选/日报同款):underline 悬浮 accent,可缺(容 null wire)。 */
function AiHotOriginalLink({ url }: { url?: string | null }) {
  if (!url) return null
  return (
    <a href={url} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-accent">
      原文
    </a>
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
          <AiHotRow
            key={p.id}
            url={p.aihotUrl}
            title={p.title}
            source={p.sourceName}
            meta={
              <>
                {p.publishedAt && <span>{timeAgo(p.publishedAt)}</span>}
                <AiHotOriginalLink url={p.originalUrl} />
              </>
            }
          />
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
                <AiHotRow
                  key={ii}
                  url={it.aihotUrl}
                  title={it.title}
                  source={it.sourceName}
                  meta={<AiHotOriginalLink url={it.originalUrl} />}
                >
                  {it.summary && (
                    <p className="text-sm text-white/60 leading-relaxed mt-1.5">{it.summary}</p>
                  )}
                </AiHotRow>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </QueryPane>
  )
}
