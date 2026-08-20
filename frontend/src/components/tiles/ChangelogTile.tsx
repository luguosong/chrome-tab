import { useMemo, useState } from 'react'
import { useChangelog } from '../../hooks/useChangelog'
import { inline } from '../../lib/changelogParser'

export default function ChangelogTile() {
  const { data, isLoading, error } = useChangelog()
  const [q, setQ] = useState('')

  const versions = data?.versions ?? []

  const shown = useMemo(() => {
    const kw = q.trim().toLowerCase()
    return kw ? versions.filter((v) => v.title.toLowerCase().includes(kw)) : versions.slice(0, 5)
  }, [q, versions])

  return (
    <section className="glass-panel rounded-3xl p-6 mx-auto max-w-2xl">
      <h2 className="text-xs uppercase tracking-wider text-white/70 mb-3 text-center">
        Claude Code 更新日志
      </h2>

      {isLoading && <div className="text-white/60 text-sm">加载中…</div>}
      {error && <div className="text-white/60 text-sm">{(error as Error).message}</div>}

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="过滤版本号…"
        className="mb-3 w-full px-3 py-2 rounded-lg bg-white/20 text-white placeholder-white/60 text-sm outline-none focus:ring-2 focus:ring-accent"
      />

      <div className="max-h-[60vh] overflow-auto pr-1.5">
        {shown.length === 0 && <div className="text-white/60 text-sm">无匹配版本</div>}
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
    </section>
  )
}
