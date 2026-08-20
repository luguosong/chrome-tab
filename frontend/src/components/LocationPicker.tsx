import { useEffect, useRef, useState } from 'react'
import { useWeatherLocations } from '../hooks/useWeather'
import type { WeatherLocation } from '../lib/weather'

/**
 * 城市选择器(见 ADR-0009「城市选择 UI」)。
 *
 * 异步搜索后端 /api/weather/locations(GeoAPI 代理)+ 结果下拉 + 选中,消歧同名城市(朝阳:北京/辽宁)
 * 靠 adm1/adm2 副标。350ms 防抖避免逐键打后端。选中即把 WeatherLocation 对象交回调用方
 * (新增抽屉 / 编辑 popover 存入 values.location,buildIconData 原样写入 data.location)。
 *
 * 值回显:value 非空时输入框 placeholder 显示已选城市(搜索文本 q 单独维护,选中后清空)。
 */
export default function LocationPicker({
  value,
  onChange,
  placeholder,
}: {
  value: WeatherLocation | null
  onChange: (loc: WeatherLocation) => void
  placeholder?: string
}) {
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setDebounced(q), 350)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [q])

  const res = useWeatherLocations(debounced)

  return (
    <div className="relative">
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        placeholder={
          value
            ? `${value.name}${value.adm1 ? ' · ' + value.adm1 : ''}${value.adm2 ? ' ' + value.adm2 : ''}`
            : (placeholder ?? '搜索城市')
        }
        aria-label="城市"
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
            {res.isLoading && <div className="px-3 py-1.5 text-xs text-white/50">搜索中…</div>}
            {!res.isLoading && (res.data?.length ?? 0) === 0 && (
              <div className="px-3 py-1.5 text-xs text-white/50">无匹配城市</div>
            )}
            {res.data?.map((c, i) => {
              const sub = [c.adm1, c.adm2].filter(Boolean).join(' / ')
              return (
                <button
                  key={`${c.lat},${c.lon},${i}`}
                  type="button"
                  onClick={() => {
                    onChange(c)
                    setQ('')
                    setOpen(false)
                  }}
                  className="block w-full text-left px-3 py-1.5 text-sm text-white/90 hover:bg-white/30"
                >
                  {c.name}
                  {sub && <span className="text-white/40 text-xs"> {sub}</span>}
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
