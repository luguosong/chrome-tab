import { useEffect, useMemo, useState } from 'react'
import { useIconData } from '../context/IconDataContext'
import { inline } from '../lib/changelogParser'

/**
 * 更新日志详情:底部 Drawer(spec user story 12)。
 *
 * 复用 useIconData 集中拉取的 changelog(由 useChangelog 维护,1h staleTime),展示完整版本
 * 列表(非摘要的前 20 条限制——本面板看完整历史,纵向滚动)。渲染沿用旧 ChangelogTile 的
 * inline() markdown 结构(top + sections)。
 *
 * 刷新失败降级(spec user story 15):changelogError 非空 → 显示「刷新失败,重试」按钮,
 * 点击重拉 changelog(关联查询)。
 *
 * 容器:fixed 底部、玻璃面板、把手 + 关闭按钮;Esc / 点遮罩关闭。
 * 编辑态进入时由父组件(DashboardPage)onClose,不在本组件重复处理。
 */
export default function ChangelogDrawer({ onClose }: { onClose: () => void }) {
  const { changelog, changelogError, refetchChangelog } = useIconData()
  const [q, setQ] = useState('')

  const versions = changelog ?? []

  const shown = useMemo(() => {
    const kw = q.trim().toLowerCase()
    return kw ? versions.filter((v) => v.title.toLowerCase().includes(kw)) : versions
  }, [q, versions])

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
      className="fixed inset-0 z-[60] flex items-end justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="更新日志"
    >
      {/* 遮罩:点击关闭 */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      <div className="glass-panel relative w-full max-w-2xl rounded-t-3xl pb-4">
        {/* 把手 */}
        <div className="flex justify-center pt-2 pb-1">
          <div className="h-1 w-10 rounded-full bg-white/30" />
        </div>

        {/* 顶栏:标题 + 关闭 */}
        <div className="flex items-center justify-between px-6 py-2">
          <h2 className="text-sm uppercase tracking-wider text-white/70">
            Claude Code 更新日志
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="w-8 h-8 rounded-full bg-white/20 text-white/80 hover:bg-white/40 flex items-center justify-center"
          >
            ×
          </button>
        </div>

        {/* 失败态 / 过滤 + 列表 */}
        <div className="px-6">
          {changelogError ? (
            <div className="flex items-center gap-3 py-6">
              <span className="text-sm text-white/60">日志刷新失败</span>
              <button
                type="button"
                onClick={refetchChangelog}
                className="border border-white/30 text-white/80 rounded-md px-2 py-0.5 text-xs hover:border-accent hover:text-accent"
              >
                刷新失败,重试
              </button>
            </div>
          ) : (
            <>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="过滤版本号…"
                className="my-3 w-full px-3 py-2 rounded-lg bg-white/20 text-white placeholder-white/60 text-sm outline-none focus:ring-2 focus:ring-accent"
              />

              <div className="max-h-[60vh] overflow-auto pr-1.5">
                {shown.length === 0 && (
                  <div className="text-white/60 text-sm py-4">
                    {versions.length === 0 ? '加载中…' : '无匹配版本'}
                  </div>
                )}
                {shown.map((v, i) => {
                  const secs = [
                    ...(v.top.length ? [{ name: '更新', items: v.top }] : []),
                    ...v.sections,
                  ]
                  return (
                    <div key={i} className="mb-4 last:mb-0">
                      <div
                        className="font-mono text-[15px] text-accent mb-1.5"
                        dangerouslySetInnerHTML={{ __html: inline(v.title) }}
                      />
                      {secs.map((s, j) => (
                        <div key={j} className="mb-1.5">
                          <div
                            className="text-[13px] text-white/90 mb-0.5"
                            dangerouslySetInnerHTML={{ __html: inline(s.name) }}
                          />
                          <ul className="text-[13px] text-white/70 space-y-0.5">
                            {s.items.map((it, k) => (
                              <li key={k} dangerouslySetInnerHTML={{ __html: inline(it) }} />
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
