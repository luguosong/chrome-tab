import { useState, type FormEvent } from 'react'
import { LensBox } from './LensBox'

/** 搜索 / URL 跳转：像 URL 则直跳（补 https://），否则 Google 搜索。
 *  L2 折射壳(ADR-0012):近透明底靠背景遮罩保证对比。focus 反馈用 outline ——
 *  .lens-panel 的 background/border 是 unlayered CSS,恒胜 Tailwind 的 layered
 *  utilities,只有 outline(独立属性域)能在容器上生效。 */
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
    <form onSubmit={go}>
      <LensBox
        radius={26}
        className="rounded-full flex items-center w-full px-5 py-3 focus-within:outline-2 focus-within:outline-white/45 focus-within:outline-offset-2"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="shrink-0 text-white/70"
        >
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索或输入网址，回车跳转"
          autoComplete="off"
          aria-label="搜索或输入网址"
          className="flex-1 min-w-0 ml-3 bg-transparent border-none outline-none text-sm text-white placeholder-white/60"
        />
      </LensBox>
    </form>
  )
}
