import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useUpdateLayoutSettings } from '../api/config'
import { LAYOUT_LIMITS } from '../lib/layoutSettings'
import type { Config, LayoutSettings } from '../lib/types'
import { BackupRestore } from './BackupRestore'

/**
 * 布局设置抽屉(见 CONTEXT.md「布局设置」)。三个连续 slider:整体宽度 / 图标间距 / 图标缩放。
 *
 * 实时预览:slider 拖动时直接乐观写 ['config'].layoutSettings 缓存,IconGrid/Icon 经
 * LayoutSettingsContext 即时反映(复用 DashboardPage 拖拽的乐观写缓存模式)。
 * 持久化:松手(pointerup/keyup)或关闭抽屉时 PUT /api/layout-settings,成功后 invalidate
 * 拉回权威值;跨设备共享(同账号任一设备登录即同此设置)。
 *
 * 容器与 AddDrawer 同构:fixed 右侧、滑入、玻璃面板、Esc / 遮罩关闭。
 */
export default function SettingsDrawer({
  layout,
  onClose,
}: {
  layout: LayoutSettings
  onClose: () => void
}) {
  const qc = useQueryClient()
  const updateLayout = useUpdateLayoutSettings()

  // 本地草稿:slider 受控源;apply 同步写缓存做实时预览。
  const [draft, setDraft] = useState<LayoutSettings>(layout)
  const draftRef = useRef(draft)
  draftRef.current = draft

  function apply<K extends keyof LayoutSettings>(key: K, value: number) {
    const next = { ...draftRef.current, [key]: value }
    setDraft(next)
    qc.setQueryData<Config>(['config'], (prev) =>
      prev ? { ...prev, layoutSettings: next } : prev,
    )
  }

  function commit() {
    updateLayout.mutate(draftRef.current)
  }

  function close() {
    commit()
    onClose()
  }

  // Esc → 落库后关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="fixed inset-0 z-[60] flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={close} />
      <aside className="glass-panel glass-panel-readable relative h-full w-full max-w-sm animate-slide-in-right overflow-y-auto p-5">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-sm font-semibold text-white/90">布局设置</h2>
          <button
            type="button"
            onClick={close}
            aria-label="关闭"
            className="w-7 h-7 rounded-full bg-white/20 text-white/80 hover:bg-white/40 flex items-center justify-center"
          >
            ×
          </button>
        </div>

        <Slider
          label="整体宽度"
          unit="px"
          value={draft.gridWidth}
          min={LAYOUT_LIMITS.gridWidth.min}
          max={LAYOUT_LIMITS.gridWidth.max}
          step={LAYOUT_LIMITS.gridWidth.step}
          onChange={(v) => apply('gridWidth', v)}
          onCommit={commit}
        />
        <Slider
          label="图标间距"
          unit="px"
          value={draft.gridGap}
          min={LAYOUT_LIMITS.gridGap.min}
          max={LAYOUT_LIMITS.gridGap.max}
          step={LAYOUT_LIMITS.gridGap.step}
          onChange={(v) => apply('gridGap', v)}
          onCommit={commit}
        />
        <Slider
          label="图标缩放"
          unit="×"
          value={draft.iconScale}
          min={LAYOUT_LIMITS.iconScale.min}
          max={LAYOUT_LIMITS.iconScale.max}
          step={LAYOUT_LIMITS.iconScale.step}
          onChange={(v) => apply('iconScale', v)}
          onCommit={commit}
        />

        <p className="mt-4 text-[11px] text-white/50 leading-relaxed">
          设置随账号保存,其它设备登录即同步。
        </p>

        <BackupRestore />
      </aside>
    </div>
  )
}

function Slider({
  label,
  unit,
  value,
  min,
  max,
  step,
  onChange,
  onCommit,
}: {
  label: string
  unit: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  onCommit: () => void
}) {
  return (
    <div className="mb-5">
      <div className="flex justify-between text-xs text-white/80 mb-1.5">
        <span>{label}</span>
        <span className="font-mono">
          {value}
          {unit}
        </span>
      </div>
      <input
        type="range"
        className="w-full accent-accent"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
      />
    </div>
  )
}
