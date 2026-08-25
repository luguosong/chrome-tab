import { useEffect, useRef, useState } from 'react'
import { useInstrumentSearch } from '../hooks/useInstrumentSearch'
import type { InstrumentCandidate } from '../lib/instrumentSearch'

const MARKET_LABEL: Record<string, string> = { sh: '沪', sz: '深', hk: '港', us: '美' }

/**
 * 标的检索选择器(见 CONTEXT.md「自选股」——标的检索):symbol 输入框原位升级,
 * 350ms 防抖调上游出候选下拉。两条出路:点候选 → onPick(symbol + 规范名,名称框
 * 自动填、换候选覆盖);不点 → 输入原样即 symbol(精确代码直提,OTC/粉单搜不到也
 * 不堵死新增)。形态对齐 LocationPicker(遮罩关闭 + glass-panel 下拉 + 市场副标
 * 消歧,如「中国平安」沪/港/美同名)。
 */
export default function SymbolPicker({
  value,
  onText,
  onPick,
  placeholder,
}: {
  value: string
  onText: (v: string) => void
  onPick: (c: InstrumentCandidate) => void
  placeholder?: string
}) {
  const [debounced, setDebounced] = useState('')
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setDebounced(value), 350)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [value])

  const res = useInstrumentSearch(debounced)

  return (
    <div className="relative">
      <input
        value={value}
        onChange={(e) => {
          onText(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        aria-label="符号"
        className="w-full px-3 py-2 rounded-lg bg-white/20 text-white placeholder-white/50 text-sm outline-none focus:ring-2 focus:ring-accent"
      />
      {open && debounced.trim() && (
        <>
          {/* 透明遮罩:click-outside 关闭 */}
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-30 cursor-default"
          />
          <div className="absolute left-0 right-0 z-40 mt-1 glass-panel glass-panel-readable rounded-lg py-1 max-h-56 overflow-y-auto">
            {res.loading && <div className="px-3 py-1.5 text-xs text-white/50">搜索中…</div>}
            {!res.loading && res.candidates.length === 0 && (
              <div className="px-3 py-1.5 text-xs text-white/50">无匹配,可按原样代码提交</div>
            )}
            {res.candidates.map((c, i) => (
              <button
                key={`${c.symbol},${i}`}
                type="button"
                onClick={() => {
                  onPick(c)
                  setDebounced(c.symbol) // 选中即同步:防抖 350ms 后的同值 setDebounced 被 bail out,不再对已选代码空发一次搜索
                  setOpen(false)
                }}
                className="block w-full text-left px-3 py-1.5 text-sm text-white/90 hover:bg-white/30"
              >
                {c.name}
                <span className="text-white/40 text-xs"> {c.symbol}</span>
                <span className="text-white/40 text-xs">
                  {' '}
                  {MARKET_LABEL[c.market] ?? c.market}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
