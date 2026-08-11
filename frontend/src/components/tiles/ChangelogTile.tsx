import { useMemo, useState } from 'react'
import { useChangelog } from '../../hooks/useChangelog'
import { inline } from '../../lib/changelogParser'

export default function ChangelogTile() {
  const { data, isLoading, error } = useChangelog()
  const [expanded, setExpanded] = useState(false)
  const [q, setQ] = useState('')

  const versions = data ?? []
  const latest = versions[0]
  const top3 = latest
    ? [...latest.top, ...latest.sections.flatMap((s) => s.items)].slice(0, 3)
    : []

  const shown = useMemo(() => {
    if (!expanded) return []
    const kw = q.trim().toLowerCase()
    return kw ? versions.filter((v) => v.title.toLowerCase().includes(kw)) : versions.slice(0, 20)
  }, [expanded, q, versions])

  const btnCls =
    'border border-gray-200 dark:border-zinc-700 text-gray-500 dark:text-zinc-400 rounded-md px-2 py-0.5 text-xs hover:border-accent hover:text-accent normal-case tracking-normal'

  return (
    <section className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-5 lg:col-span-2">
      <h2 className="flex items-center justify-between text-xs uppercase tracking-wider text-gray-500 dark:text-zinc-400 mb-3">
        <span>Claude Code 更新日志</span>
        <button onClick={() => setExpanded((v) => !v)} className={btnCls}>
          {expanded ? '收起' : '展开'}
        </button>
      </h2>

      {isLoading && <div className="text-gray-400 dark:text-zinc-500 text-sm">加载中…</div>}
      {error && <div className="text-gray-400 dark:text-zinc-500 text-sm">{(error as Error).message}</div>}

      {latest && !expanded && (
        <div>
          <div className="font-mono text-base text-accent mb-1">{latest.title}</div>
          <ul className="text-[13px] text-gray-600 dark:text-zinc-300 space-y-0.5">
            {top3.map((it, i) => (
              <li key={i} dangerouslySetInnerHTML={{ __html: inline(it) }} />
            ))}
          </ul>
        </div>
      )}

      {expanded && (
        <div>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="过滤版本号…"
            className="mb-3 w-full px-3 py-2 border border-gray-200 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 rounded-lg text-sm outline-none focus:border-accent"
          />
          <div className="max-h-[520px] overflow-auto pr-1.5">
            {shown.length === 0 && <div className="text-gray-400 dark:text-zinc-500 text-sm">无匹配版本</div>}
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
                        className="text-[13px] text-gray-700 dark:text-zinc-200 mb-0.5"
                        dangerouslySetInnerHTML={{ __html: inline(s.name) }}
                      />
                      <ul className="text-[13px] text-gray-500 dark:text-zinc-400 space-y-0.5">
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
        </div>
      )}
    </section>
  )
}
