import { useState, type FormEvent } from 'react'

/** 搜索 / URL 跳转：像 URL 则直跳（补 https://），否则 Google 搜索 */
export default function SearchBox() {
  const [q, setQ] = useState('')
  function go(e: FormEvent) {
    e.preventDefault()
    const v = q.trim()
    if (!v) return
    const isUrl = /^https?:\/\//i.test(v) || /^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(v)
    location.href = isUrl
      ? v.startsWith('http') ? v : `https://${v}`
      : `https://www.google.com/search?q=${encodeURIComponent(v)}`
  }
  return (
    <form onSubmit={go} className="flex-1 max-w-xl min-w-[240px]">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="搜索或输入网址，回车跳转"
        autoComplete="off"
        className="w-full bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 text-gray-800 dark:text-zinc-100 px-4 py-3 rounded-xl outline-none focus:border-accent"
      />
    </form>
  )
}
