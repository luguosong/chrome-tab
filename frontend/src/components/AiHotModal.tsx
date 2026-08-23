import { useEffect } from 'react'
import { useAiHot } from '../hooks/useAiHot'
import { timeAgo } from '../lib/timeAgo'
import { extractString } from '../lib/iconData'
import type { Icon } from '../lib/types'

/**
 * AI 热点详情 Modal(见 CONTEXT.md「AI 热点」,与天气同范式的详情容器)。
 * 完整热点榜单:条目主跳 AIHOT 站内事件页(links.story,报道时间线 + AI 综述,
 * 新标签打开),原文出处(links.original)作次链接直给。数据自持 useAiHot
 * (与图标 body 同 queryKey 去重);失败(null / isError)→ 顶部「刷新失败,重试」。
 * 容器:fixed 遮罩 + 居中玻璃面板;Esc / 点遮罩关闭(同 WeatherModal)。
 */
export default function AiHotModal({ icon, onClose }: { icon: Icon; onClose: () => void }) {
  const { data, isError, refetch, isFetching } = useAiHot()
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
      aria-label="AI 热点榜单"
    >
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      <div className="glass-panel glass-panel-readable relative w-full max-w-lg rounded-3xl p-6 max-h-[80vh] overflow-y-auto">
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭"
          className="absolute top-3 right-3 w-8 h-8 rounded-full bg-white/20 text-white/80 hover:bg-white/40 flex items-center justify-center"
        >
          ×
        </button>

        <div className="mb-4">
          <div className="text-lg text-white/90">
            {extractString(icon.data, 'name') || 'AI 热点'}
          </div>
          <div className="text-xs text-white/50">AIHOT 事件级热点榜,点击条目看时间线与综述</div>
        </div>

        {failed ? (
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
        )}
      </div>
    </div>
  )
}
