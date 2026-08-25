import { useEffect, useState } from 'react'
import type { VideoBlogger, VideoFeedItem } from 'chrome-tab-shared'
import {
  useAddVideoBlogger,
  useCreateVideoCategory,
  useDeleteVideoBlogger,
  useDeleteVideoCategory,
  useRenameVideoCategory,
  useReorderVideoCategories,
  useSetVideoBloggerCategory,
  useVideoBloggers,
  useVideoCategories,
  useVideoFeed,
} from '../hooks/useVideoUpdates'
import { timeAgo } from '../lib/timeAgo'
import ConfirmButton from './ConfirmButton'

/** 新视频红点窗口(与 VideoIconBody 同口径):发布 <24h,时间驱动满窗自隐。 */
const NEW_WINDOW_S = 24 * 60 * 60

const isNew = (v: VideoFeedItem) => Date.now() / 1000 - v.publishedAt < NEW_WINDOW_S
const iso = (sec: number) => new Date(sec * 1000).toISOString()
const fmtDuration = (sec: number) => {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`
}
const platformLabel = (p: string) => (p === 'youtube' ? 'YouTube' : 'B站')

/**
 * 视频更新详情 Modal(见 CONTEXT.md「视频更新」):tab = 全部(默认,混合时间流)→
 * 未分类(仅当桶内有博主)→ 各分类(sort_order)→ 管理。视频条目 = 缩略图(no-referrer
 * 直连,B站 hdslb 防盗链实测自家域 Referer 必 403)+ 右下时长角标(无时长则无角标,
 * 无 key 降级口径)+ 标题两行截断 + 博主名·相对时间,整条外跳原平台。管理 tab:分类
 * 增删改排序(删 → 博主回未分类)与博主添加/归类/删除(status='failing' 标红)。
 * 容器:fixed 遮罩 + 居中玻璃面板,Esc / 点遮罩关闭(同 TodoModal)。
 */
type Tab = 'all' | 'uncategorized' | `cat-${number}` | 'manage'

export default function VideoModal({ onClose }: { onClose: () => void }) {
  const feed = useVideoFeed()
  const cats = useVideoCategories()
  const [tab, setTab] = useState<Tab>('all')

  // spec:Modal 打开时 refetch(打开即对账最新视频;refetch 引用稳定,空依赖安全)
  useEffect(() => {
    void feed.refetch()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const videos = feed.data ?? []
  const categories = cats.data?.categories ?? []
  const tabs: Array<{ key: Tab; label: string }> = [
    { key: 'all', label: '全部' },
    ...(cats.data && cats.data.uncategorizedCount > 0
      ? [{ key: 'uncategorized' as Tab, label: '未分类' }]
      : []),
    ...categories.map((c) => ({ key: `cat-${c.id}` as Tab, label: c.name })),
    { key: 'manage', label: '管理' },
  ]
  const shown =
    tab === 'all'
      ? videos
      : tab === 'uncategorized'
        ? videos.filter((v) => v.categoryId === null)
        : tab.startsWith('cat-')
          ? videos.filter((v) => v.categoryId === Number(tab.slice(4)))
          : []

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="视频更新"
    >
      <div className="absolute inset-0 bg-black/50 animate-fade-in" onClick={onClose} />

      <div className="glass-panel glass-panel-readable relative w-full max-w-2xl rounded-3xl p-6 max-h-[80vh] overflow-y-auto modal-scroll animate-pop-in">
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭"
          className="absolute top-3 right-3 w-8 h-8 rounded-full bg-white/20 text-white/80 hover:bg-white/40 focus-visible:outline-2 focus-visible:outline-white/60 flex items-center justify-center"
        >
          ×
        </button>

        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-lg font-semibold text-white/90">视频更新</h2>
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

        <div role="tablist" aria-label="视频视图" className="flex gap-4 border-b border-white/10 mb-3 overflow-x-auto">
          {tabs.map(({ key, label }) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              type="button"
              onClick={() => setTab(key)}
              className={
                'pb-1.5 -mb-px text-sm border-b-2 whitespace-nowrap transition focus-visible:outline-2 focus-visible:outline-white/60 ' +
                (tab === key
                  ? 'text-accent border-accent'
                  : 'text-white/60 border-transparent hover:text-white/85')
              }
            >
              {label}
            </button>
          ))}
        </div>

        {feed.isError ? (
          <div className="flex items-center gap-3 py-4">
            <span className="text-sm text-white/60">视频流刷新失败</span>
            <button
              type="button"
              onClick={() => void feed.refetch()}
              disabled={feed.isFetching}
              className="border border-white/30 text-white/80 rounded-md px-2 py-0.5 text-xs hover:border-accent hover:text-accent disabled:opacity-50"
            >
              重试
            </button>
          </div>
        ) : tab === 'manage' ? (
          <ManagePane />
        ) : videos.length === 0 ? (
          <div className="text-sm text-white/50 py-6 text-center">
            还没有博主——去「管理」粘贴主页链接添加
          </div>
        ) : shown.length === 0 ? (
          <div className="text-sm text-white/50 py-6 text-center">这个分类还没有视频</div>
        ) : (
          <ul className="space-y-1">
            {shown.map((v) => (
              <VideoRow key={v.id} video={v} />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

/** 单条视频:整条外跳原平台(新标签);缩略图 no-referrer(B站防盗链);时长角标缺时长则无。 */
function VideoRow({ video: v }: { video: VideoFeedItem }) {
  return (
    <li>
      <a
        href={v.url}
        target="_blank"
        rel="noreferrer"
        className="flex gap-3 rounded-xl p-2 hover:bg-white/10 transition-colors"
      >
        <span className="relative shrink-0 w-32 aspect-video rounded-lg overflow-hidden bg-white/10">
          {v.thumbnailUrl && (
            <img
              src={v.thumbnailUrl}
              alt=""
              referrerPolicy="no-referrer"
              loading="lazy"
              className="absolute inset-0 w-full h-full object-cover"
            />
          )}
          {!!v.durationSeconds && (
            <span className="absolute right-1 bottom-1 rounded bg-black/70 px-1 font-mono text-meta text-white/90">
              {fmtDuration(v.durationSeconds)}
            </span>
          )}
        </span>
        <span className="flex-1 min-w-0 flex flex-col py-0.5">
          <span className="flex items-start gap-1.5">
            {isNew(v) && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-red-400" aria-hidden="true" />}
            <span className="text-sm text-white/90 line-clamp-2 break-all" title={v.title}>
              {v.title}
            </span>
          </span>
          <span className="mt-auto pt-1 text-xs text-white/45">
            {v.bloggerName} · {timeAgo(iso(v.publishedAt))} · {platformLabel(v.platform)}
          </span>
        </span>
      </a>
    </li>
  )
}

/** 管理 tab:分类区(增删改排序)与博主区(添加/归类/删除,异常标红)。 */
function ManagePane() {
  const cats = useVideoCategories()
  const bloggers = useVideoBloggers()
  const addBlogger = useAddVideoBlogger()
  const deleteBlogger = useDeleteVideoBlogger()
  const setCategory = useSetVideoBloggerCategory()
  const createCategory = useCreateVideoCategory()
  const renameCategory = useRenameVideoCategory()
  const deleteCategory = useDeleteVideoCategory()
  const reorder = useReorderVideoCategories()
  const [urlDraft, setUrlDraft] = useState('')
  const [catDraft, setCatDraft] = useState('')
  const [renamingId, setRenamingId] = useState<number | null>(null)
  const [renameDraft, setRenameDraft] = useState('')

  const categories = cats.data?.categories ?? []
  const move = (id: number, dir: -1 | 1) => {
    const ids = categories.map((c) => c.id)
    const i = ids.indexOf(id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j]!, ids[i]!]
    reorder.mutate(ids)
  }

  const submitBlogger = () => {
    const url = urlDraft.trim()
    if (!url || addBlogger.isPending) return
    addBlogger.mutate(url, { onSuccess: () => setUrlDraft('') })
  }
  const submitCategory = () => {
    const name = catDraft.trim()
    if (!name || createCategory.isPending) return
    createCategory.mutate(name, { onSuccess: () => setCatDraft('') })
  }

  return (
    <div className="space-y-5">
      {/* 分类区 */}
      <section aria-label="分类管理">
        <h3 className="mb-2 text-meta uppercase tracking-wider text-white/50">分类</h3>
        <ul className="space-y-1">
          {categories.map((c, i) => (
            <li key={c.id} className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-white/5">
              {renamingId === c.id ? (
                <input
                  autoFocus
                  value={renameDraft}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && renameDraft.trim()) {
                      renameCategory.mutate({ id: c.id, name: renameDraft.trim() })
                      setRenamingId(null)
                    }
                    if (e.key === 'Escape') setRenamingId(null)
                  }}
                  onBlur={() => setRenamingId(null)}
                  className="flex-1 min-w-0 rounded-lg bg-white/10 px-2 py-1 text-sm text-white/90 outline-none focus:ring-1 focus:ring-accent"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setRenamingId(c.id)
                    setRenameDraft(c.name)
                  }}
                  title="重命名"
                  className="flex-1 min-w-0 truncate text-left text-sm text-white/90 hover:text-accent"
                >
                  {c.name}
                  <span className="ml-1.5 font-mono text-xs text-white/45">{c.bloggerCount}</span>
                </button>
              )}
              <span className="flex shrink-0 items-center gap-1 text-xs text-white/50">
                <button
                  type="button"
                  aria-label="上移"
                  disabled={i === 0}
                  onClick={() => move(c.id, -1)}
                  className="w-6 h-6 rounded-full hover:bg-white/15 disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label="下移"
                  disabled={i === categories.length - 1}
                  onClick={() => move(c.id, 1)}
                  className="w-6 h-6 rounded-full hover:bg-white/15 disabled:opacity-30"
                >
                  ↓
                </button>
                <ConfirmButton
                  label={`删除分类 ${c.name}`}
                  title="删除分类(博主将归入未分类)"
                  onConfirm={() => deleteCategory.mutate(c.id)}
                />
              </span>
            </li>
          ))}
        </ul>
        {categories.length === 0 && (
          <p className="text-sm text-white/50 py-2">暂无分类——博主默认进「未分类」桶</p>
        )}
        <div className="mt-2 flex items-center gap-2">
          <input
            value={catDraft}
            onChange={(e) => setCatDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submitCategory()}
            placeholder="新分类名称"
            className="flex-1 min-w-0 rounded-xl bg-white/10 px-3 py-2 text-sm text-white/90 placeholder:text-white/35 outline-none focus:ring-1 focus:ring-accent"
          />
          <button
            type="button"
            onClick={submitCategory}
            disabled={!catDraft.trim()}
            className="rounded-xl bg-white/15 hover:bg-white/25 px-3 py-2 text-sm text-white/90 disabled:opacity-50"
          >
            新建
          </button>
        </div>
      </section>      {/* 博主区 */}
      <section aria-label="博主管理">
        <h3 className="mb-2 text-meta uppercase tracking-wider text-white/50">博主</h3>
        {bloggers.data !== undefined && bloggers.data.length === 0 ? (
          <p className="text-sm text-white/50 py-2">粘贴 YouTube 频道页或 B站空间页链接添加博主</p>
        ) : (
          <ul className="space-y-1">
            {(bloggers.data ?? []).map((b) => (
              <BloggerRow
                key={b.id}
                blogger={b}
                categories={categories}
                onCategorize={(categoryId) => setCategory.mutate({ id: b.id, categoryId })}
                onDelete={() => deleteBlogger.mutate(b.id)}
              />
            ))}
          </ul>
        )}
        <div className="mt-2 flex items-center gap-2">
          <input
            value={urlDraft}
            onChange={(e) => setUrlDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submitBlogger()}
            placeholder={addBlogger.isPending ? '解析博主信息…' : 'https://www.youtube.com/@… 或 https://space.bilibili.com/…'}
            disabled={addBlogger.isPending}
            className="flex-1 min-w-0 rounded-xl bg-white/10 px-3 py-2 text-sm text-white/90 placeholder:text-white/35 outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
          />
          <button
            type="button"
            onClick={submitBlogger}
            disabled={addBlogger.isPending || !urlDraft.trim()}
            className="rounded-full bg-accent px-3.5 py-2 text-sm font-medium text-white transition hover:bg-accent/90
              active:bg-accent/80 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-white/60"
          >
            添加
          </button>
        </div>
        {addBlogger.isError && (
          <p className="mt-1 text-xs text-red-300">{(addBlogger.error as Error).message}</p>
        )}
      </section>


    </div>
  )
}

/** 博主行:头像/占位 + 名 + 平台 + 分类下拉 + 异常标红 + 删除(重加即重新首取,无损)。 */
function BloggerRow({
  blogger: b,
  categories,
  onCategorize,
  onDelete,
}: {
  blogger: VideoBlogger
  categories: Array<{ id: number; name: string }>
  onCategorize: (categoryId: number | null) => void
  onDelete: () => void
}) {
  return (
    <li className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 hover:bg-white/5">
      {b.avatarUrl ? (
        <img
          src={b.avatarUrl}
          alt=""
          referrerPolicy="no-referrer"
          className="shrink-0 w-7 h-7 rounded-full bg-white/10 object-cover"
        />
      ) : (
        <span className="shrink-0 w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-xs text-white/50">
          {b.name.slice(0, 1)}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-white/90" title={b.name}>
          {b.name}
        </span>
        <span className={'block text-xs ' + (b.status === 'failing' ? 'text-red-300' : 'text-white/40')}>
          {platformLabel(b.platform)}
          {b.status === 'failing' && ' · 取数失败(连续 24 轮,待凭据或接口恢复)'}
        </span>
      </span>
      <select
        aria-label={`设置 ${b.name} 的分类`}
        value={b.categoryId ?? ''}
        onChange={(e) => onCategorize(e.target.value ? Number(e.target.value) : null)}
        className="shrink-0 rounded-lg bg-white/10 px-2 py-1 text-xs text-white/85 outline-none"
      >
        <option value="">未分类</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <ConfirmButton
        label={`删除博主 ${b.name}`}
        title="删除博主(重新添加会重新拉取历史)"
        onConfirm={onDelete}
      />
    </li>
  )
}
