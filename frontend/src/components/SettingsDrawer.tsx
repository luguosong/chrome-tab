import type { ReactNode } from 'react'
import { LAYOUT_LIMITS } from '../lib/layoutSettings'
import type { LayoutSettings } from '../lib/types'
import { BackupRestore } from './BackupRestore'

/**
 * 布局面板(见 CONTEXT.md「布局设置」,五组):ControlDrawer 的「布局」tab 内容。
 * 按 网格 / 背景 / 搜索栏 / 时钟 / 图标名称 分节,底部为备份恢复。
 *
 * 受控组件:draft 与落库(commit)由 ControlDrawer 持有——实时预览是乐观写
 * ['config'].layoutSettings 缓存,IconGrid/Icon/Clock/SearchBox/DashboardPage 经
 * LayoutSettingsContext 即时反映;持久化在松手(pointerup/keyup/change)或关闭抽屉时
 * PUT /api/layout-settings。
 */
export function SettingsPane({
  draft,
  onApply,
  onCommit,
}: {
  draft: LayoutSettings
  onApply: <K extends keyof LayoutSettings>(key: K, value: LayoutSettings[K]) => void
  onCommit: () => void
}) {
  /** 离散控件(开关/下拉):改即提交,无需松手语义。 */
  function applyNow<K extends keyof LayoutSettings>(key: K, value: LayoutSettings[K]) {
    onApply(key, value)
    onCommit()
  }

  return (
    <>
      <Section>网格</Section>
      <Slider
        label="整体宽度"
        unit="px"
        value={draft.gridWidth}
        min={LAYOUT_LIMITS.gridWidth.min}
        max={LAYOUT_LIMITS.gridWidth.max}
        step={LAYOUT_LIMITS.gridWidth.step}
        onChange={(v) => onApply('gridWidth', v)}
        onCommit={onCommit}
      />
      <Slider
        label="横向间距"
        unit="px"
        value={draft.gridGap}
        min={LAYOUT_LIMITS.gridGap.min}
        max={LAYOUT_LIMITS.gridGap.max}
        step={LAYOUT_LIMITS.gridGap.step}
        onChange={(v) => onApply('gridGap', v)}
        onCommit={onCommit}
      />
      <Slider
        label="竖向间距"
        unit="px"
        value={draft.gridGapY}
        min={LAYOUT_LIMITS.gridGapY.min}
        max={LAYOUT_LIMITS.gridGapY.max}
        step={LAYOUT_LIMITS.gridGapY.step}
        onChange={(v) => onApply('gridGapY', v)}
        onCommit={onCommit}
      />
      <Slider
        label="图标缩放"
        unit="×"
        value={draft.iconScale}
        min={LAYOUT_LIMITS.iconScale.min}
        max={LAYOUT_LIMITS.iconScale.max}
        step={LAYOUT_LIMITS.iconScale.step}
        onChange={(v) => onApply('iconScale', v)}
        onCommit={onCommit}
      />

      <Section>背景</Section>
      <Slider
        label="雾化浓度"
        unit="%"
        value={draft.panelFog}
        min={LAYOUT_LIMITS.panelFog.min}
        max={LAYOUT_LIMITS.panelFog.max}
        step={LAYOUT_LIMITS.panelFog.step}
        onChange={(v) => onApply('panelFog', v)}
        onCommit={onCommit}
      />

      <Section>搜索栏</Section>
      <Slider
        label="宽度"
        unit="px"
        value={draft.searchBarWidth}
        min={LAYOUT_LIMITS.searchBarWidth.min}
        max={LAYOUT_LIMITS.searchBarWidth.max}
        step={LAYOUT_LIMITS.searchBarWidth.step}
        onChange={(v) => onApply('searchBarWidth', v)}
        onCommit={onCommit}
      />
      <Toggle
        label="显示搜索栏"
        checked={draft.searchBarVisible}
        onChange={(v) => applyNow('searchBarVisible', v)}
      />
      <Row label="搜索引擎">
        <select
          value={draft.searchEngine}
          onChange={(e) =>
            applyNow('searchEngine', e.target.value as LayoutSettings['searchEngine'])
          }
          className="rounded-full bg-white/10 px-3 py-1.5 text-xs text-white/90 cursor-pointer focus-visible:outline-2 focus-visible:outline-white/60"
        >
          <option value="google">Google</option>
          <option value="bing">Bing</option>
          <option value="baidu">百度</option>
        </select>
      </Row>

      <Section>时钟</Section>
      <Toggle
        label="显示时钟"
        checked={draft.clockVisible}
        onChange={(v) => applyNow('clockVisible', v)}
      />
      <Slider
        label="字号"
        unit="px"
        value={draft.clockFont}
        min={LAYOUT_LIMITS.clockFont.min}
        max={LAYOUT_LIMITS.clockFont.max}
        step={LAYOUT_LIMITS.clockFont.step}
        onChange={(v) => onApply('clockFont', v)}
        onCommit={onCommit}
      />
      <Toggle
        label="24 小时制"
        checked={draft.clock24h}
        onChange={(v) => applyNow('clock24h', v)}
      />

      <Section>图标名称</Section>
      <Toggle
        label="显示名称"
        checked={draft.labelVisible}
        onChange={(v) => applyNow('labelVisible', v)}
      />
      <Slider
        label="字号"
        unit="px"
        value={draft.labelSize}
        min={LAYOUT_LIMITS.labelSize.min}
        max={LAYOUT_LIMITS.labelSize.max}
        step={LAYOUT_LIMITS.labelSize.step}
        onChange={(v) => onApply('labelSize', v)}
        onCommit={onCommit}
      />
      <Row label="颜色">
        <input
          type="color"
          aria-label="图标名称颜色"
          value={draft.labelColor}
          onChange={(e) => onApply('labelColor', e.target.value)}
          onBlur={onCommit}
          className="h-7 w-12 cursor-pointer rounded-md border border-white/25 bg-transparent p-0.5
            [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-sm [&::-webkit-color-swatch]:border-none"
        />
      </Row>

      <p className="mt-4 text-[11px] text-white/50 leading-relaxed">
        设置随账号保存,其它设备登录即同步。
      </p>

      <BackupRestore />
    </>
  )
}

/** 节标题:小字 + 发丝线,只承担分组导航,不与控件抢视觉。 */
function Section({ children }: { children: string }) {
  return (
    <h3 className="pt-2 pb-1.5 mb-4 border-b border-white/10 text-[11px] font-medium tracking-[0.15em] text-white/45">
      {children}
    </h3>
  )
}

/** 行骨架:标签在左、控件在右,与 Slider 的标签行同一节奏。 */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mb-5 flex items-center justify-between text-xs text-white/80">
      <span>{label}</span>
      {children}
    </div>
  )
}

/** iOS 胶囊开关:与主屏隐喻同源;sr-only input 保留键盘/读屏可达,焦点环经 peer 作用于轨道。 */
function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <Row label={label}>
      <label className="relative inline-flex cursor-pointer">
        <input
          type="checkbox"
          className="peer sr-only"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="block h-5 w-9 rounded-full bg-white/20 transition-colors
          peer-checked:bg-accent peer-focus-visible:outline-2 peer-focus-visible:outline-white/60 peer-focus-visible:outline-offset-2" />
        <span className="absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform
          peer-checked:translate-x-4" />
      </label>
    </Row>
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
