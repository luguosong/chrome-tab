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
    <form onSubmit={go} className="relative">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="搜索或输入网址，回车跳转"
        autoComplete="off"
        className="w-full bg-white/25 dark:bg-white/10 border border-white/30 text-white placeholder-white/60 pl-5 pr-14 py-3 rounded-full outline-none transition shadow-lg focus:bg-white/35 focus:border-white/50 focus:ring-2 focus:ring-accent/70"
      />

      {/* 搜索按钮：暖色实心圆，整片冷玻璃里唯一的暖色动作焦点 */}
      <button
        type="submit"
        aria-label="搜索"
        className="absolute right-1.5 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center rounded-full bg-accent text-white shadow-md transition hover:bg-accent/90 active:scale-95"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      </button>
    </form>
  )
}
