import { useState, type FormEvent } from 'react'
import { useAddStockWatch, useConfig, useDeleteStockWatch } from '../../api/config'
import { useQuotes } from '../../hooks/useQuotes'
import type { Quote } from '../../lib/quoteParser'

function fmt(q: Quote) {
  const up = q.change >= 0
  return {
    cls: up ? 'text-up' : 'text-down',
    arr: up ? '▲' : '▼',
    price: q.price.toFixed(2),
    chg: Math.abs(q.change).toFixed(2),
    pct: Math.abs(q.pct).toFixed(2),
  }
}

export default function StockTile() {
  const { data } = useConfig()
  const watches = data?.stockWatches ?? []
  const symbols = watches.map((w) => w.symbol)
  const quotesQ = useQuotes(symbols)
  const add = useAddStockWatch()
  const del = useDeleteStockWatch()
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [sym, setSym] = useState('')
  const [name, setName] = useState('')

  const quotes = quotesQ.data ?? {}
  const updated = quotesQ.dataUpdatedAt
    ? new Date(quotesQ.dataUpdatedAt).toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
      })
    : ''
  const groupNames = [...new Set(watches.map((w) => w.groupName))]

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!sym.trim() || !name.trim()) return
    add.mutate({ symbol: sym.trim(), name: name.trim() })
    setSym('')
    setName('')
  }

  const btnCls =
    'border border-gray-200 dark:border-zinc-700 text-gray-500 dark:text-zinc-400 rounded-md px-2 py-0.5 text-xs hover:border-accent hover:text-accent'

  return (
    <section className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-5">
      <h2 className="flex items-center justify-between text-xs uppercase tracking-wider text-gray-500 dark:text-zinc-400 mb-3">
        <span>行情</span>
        <span className="flex items-center gap-2 normal-case tracking-normal">
          {updated && <span className="text-[11px] text-gray-400 dark:text-zinc-500 font-mono">更新于 {updated}</span>}
          <button onClick={() => quotesQ.refetch()} className={btnCls}>刷新</button>
          <button onClick={() => setExpanded((v) => !v)} className={btnCls}>
            {expanded ? '收起' : '展开'}
          </button>
          {expanded && (
            <button
              onClick={() => setEditing((v) => !v)}
              className={
                editing
                  ? 'border border-accent text-accent rounded-md px-2 py-0.5 text-xs'
                  : btnCls
              }
            >
              编辑
            </button>
          )}
        </span>
      </h2>

      {quotesQ.isLoading && <div className="text-gray-400 dark:text-zinc-500 text-sm">加载中…</div>}
      {quotesQ.isError && (
        <div className="text-gray-400 dark:text-zinc-500 text-sm">{(quotesQ.error as Error).message}</div>
      )}

      {!expanded ? (
        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(116px, 1fr))' }}>
          {watches.slice(0, 6).map((w) => {
            const q = quotes[w.symbol]
            if (!q) {
              return (
                <div key={w.id} className="border border-gray-200 dark:border-zinc-800 rounded-lg px-3 py-2">
                  <div className="text-xs text-gray-600 dark:text-zinc-300 truncate">{w.name}</div>
                  <div className="text-gray-300 dark:text-zinc-600 font-mono text-sm">--</div>
                </div>
              )
            }
            const f = fmt(q)
            return (
              <div key={w.id} className="border border-gray-200 dark:border-zinc-800 rounded-lg px-3 py-2">
                <div className="text-xs text-gray-600 dark:text-zinc-300 truncate">{w.name}</div>
                <div className={`font-mono text-sm ${f.cls}`}>{f.price}</div>
                <div className={`font-mono text-[11px] ${f.cls}`}>{f.arr} {f.pct}%</div>
              </div>
            )
          })}
        </div>
      ) : (
        <div>
          {groupNames.map((g) => (
            <div key={g}>
              <div className="text-[11px] text-gray-400 dark:text-zinc-500 tracking-wider mt-3 mb-1 first:mt-0">{g}</div>
              {watches
                .filter((w) => w.groupName === g)
                .map((w) => {
                  const q = quotes[w.symbol]
                  const code = w.symbol.replace(/^(us|sh|sz)/, '')
                  return (
                    <div key={w.id} className="grid grid-cols-[1fr_auto] gap-1 py-1.5 border-b border-gray-100 dark:border-zinc-800 last:border-0">
                      <div>
                        <div className="text-[13px] text-gray-700 dark:text-zinc-200">{w.name}</div>
                        <div className="text-[11px] text-gray-400 dark:text-zinc-500 font-mono">{code}</div>
                      </div>
                      {q ? (
                        (() => {
                          const f = fmt(q)
                          return (
                            <div className="text-right">
                              <div className={`font-mono text-sm ${f.cls}`}>{f.price}</div>
                              <div className={`font-mono text-xs ${f.cls}`}>{f.arr} {f.chg} ({f.pct}%)</div>
                            </div>
                          )
                        })()
                      ) : (
                        <div className="text-right text-gray-300 dark:text-zinc-600 text-xs self-center">—</div>
                      )}
                      {editing && (
                        <button
                          onClick={() => del.mutate(w.id)}
                          className="col-span-2 text-left text-red-400 hover:text-red-600 text-xs"
                        >
                          删除 {w.name}
                        </button>
                      )}
                    </div>
                  )
                })}
            </div>
          ))}
          {editing && (
            <form onSubmit={submit} className="flex gap-2 mt-3">
              <input
                value={sym}
                onChange={(e) => setSym(e.target.value)}
                placeholder="符号 如 usAAPL"
                className="flex-1 px-2.5 py-2 border border-gray-200 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 rounded-lg text-sm outline-none focus:border-accent"
              />
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="名称"
                className="flex-1 px-2.5 py-2 border border-gray-200 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 rounded-lg text-sm outline-none focus:border-accent"
              />
              <button type="submit" disabled={add.isPending} className="px-3.5 rounded-lg bg-accent text-white text-sm disabled:opacity-50">
                添加
              </button>
            </form>
          )}
        </div>
      )}
    </section>
  )
}
