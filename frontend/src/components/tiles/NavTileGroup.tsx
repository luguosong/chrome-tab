import { useState, type FormEvent } from 'react'
import { useAddNavLink, useConfig, useDeleteNavLink } from '../../api/config'

function favicon(url: string): string {
  try {
    const domain = new URL(url).hostname
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`
  } catch {
    return ''
  }
}

/** 自动补 https://，对齐原型行为 */
function normalizeUrl(u: string): string {
  return /^https?:\/\//i.test(u) ? u : `https://${u}`
}

export default function NavTileGroup() {
  const { data } = useConfig()
  const add = useAddNavLink()
  const del = useDeleteNavLink()
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const links = data?.navLinks ?? []

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim() || !url.trim()) return
    add.mutate({ name: name.trim(), url: normalizeUrl(url.trim()) })
    setName('')
    setUrl('')
  }

  return (
    <section className="bg-white border border-gray-200 rounded-2xl p-5">
      <h2 className="text-xs uppercase tracking-wider text-gray-500 mb-3">快速导航</h2>
      <div
        className="grid gap-2.5"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))' }}
      >
        {links.map((n) => (
          <a
            key={n.id}
            href={n.url}
            target="_blank"
            rel="noreferrer"
            className="group relative flex flex-col items-center gap-1.5 p-3 border border-gray-200 rounded-lg hover:border-accent hover:bg-gray-50 transition"
          >
            {favicon(n.url) && (
              <img
                src={favicon(n.url)}
                alt=""
                className="w-5 h-5 rounded"
                referrerPolicy="no-referrer"
              />
            )}
            <span className="text-xs text-gray-700 max-w-full truncate">{n.name}</span>
            <button
              type="button"
              title="删除"
              onClick={(e) => {
                e.preventDefault()
                del.mutate(n.id)
              }}
              className="absolute top-1 right-1.5 text-gray-400 opacity-0 group-hover:opacity-100 hover:text-red-500 leading-none"
            >
              ×
            </button>
          </a>
        ))}
      </div>
      <form onSubmit={submit} className="flex gap-2 mt-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="名称"
          maxLength={12}
          className="flex-1 px-2.5 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-accent"
        />
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…"
          className="flex-[2] px-2.5 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={add.isPending}
          className="px-3.5 rounded-lg bg-accent text-white text-sm disabled:opacity-50"
        >
          添加
        </button>
      </form>
    </section>
  )
}
