import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useUpdateLayoutSettings } from '../api/config'
import type { Config, IconTypeId, LayoutSettings } from '../lib/types'
import { AddPane } from './AddDrawer'
import { SettingsPane } from './SettingsDrawer'

/**
 * 控制抽屉(见 CONTEXT.md「新增抽屉」/「布局设置」):右上角 ⚙ 唤起的统一侧抽屉,
 * tab 切换「新增 / 布局」两块内容(原 AddDrawer + SettingsDrawer 合并,壳唯一)。
 *
 * tab 用原生 hidden 切换:两 pane 保持挂载,新增表单半填内容 / 布局草稿切 tab 不丢,
 * 且 hidden 子树自动移出焦点链。布局 draft/commit 上收到壳:关闭(Esc/遮罩/×)前
 * flush 落库(松手 commit 之外的兜底),dirty 守卫避免无谓 PUT。
 *
 * 容器与原 AddDrawer 同构:fixed 右侧、滑入、玻璃面板、sticky 顶栏(tab 栏 + 关闭)。
 */
type Tab = 'add' | 'layout'

export default function ControlDrawer({
  pageId,
  existingTypeIds,
  layout,
  onClose,
}: {
  /** 当前激活页 id——新图标落到此页末尾。undefined 时禁用提交(无页可加)。 */
  pageId: number | undefined
  /** 当前用户全部图标出现的类型集合——用于单例置灰判断(单例=全局唯一,跨页)。 */
  existingTypeIds: IconTypeId[]
  layout: LayoutSettings
  onClose: () => void
}) {
  const qc = useQueryClient()
  const updateLayout = useUpdateLayoutSettings()
  const [tab, setTab] = useState<Tab>('add')

  // 布局草稿(原 SettingsDrawer 逻辑上移):slider 受控源;apply 乐观写缓存实时预览。
  const [draft, setDraft] = useState<LayoutSettings>(layout)
  const draftRef = useRef(draft)
  draftRef.current = draft
  const dirtyRef = useRef(false)

  function apply<K extends keyof LayoutSettings>(key: K, value: LayoutSettings[K]) {
    const next = { ...draftRef.current, [key]: value }
    dirtyRef.current = true
    // ref 同步回写:开关/下拉「改即提交」在 setDraft 的重渲染前就调 commit,
    // 若只靠渲染期回写,commit 会发出旧 draft,回拉后本次改动被静默回滚
    draftRef.current = next
    setDraft(next)
    qc.setQueryData<Config>(['config'], (prev) =>
      prev ? { ...prev, layoutSettings: next } : prev,
    )
  }

  function commit() {
    if (!dirtyRef.current) return
    dirtyRef.current = false
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

  // tablist 箭头键切换(WAI-ARIA tabs 模式):左右移到另一 tab 并聚焦
  function onTablistKeyDown(e: React.KeyboardEvent) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const next: Tab = tab === 'add' ? 'layout' : 'add'
    setTab(next)
    document.getElementById(`tab-${next}`)?.focus()
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'add', label: '新增' },
    { id: 'layout', label: '布局' },
  ]

  return (
    <div
      className="fixed inset-0 z-[60] flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="新增与设置"
    >
      {/* 遮罩:点击关闭 */}
      <div className="absolute inset-0 bg-black/50" onClick={close} />

      <aside className="glass-panel glass-panel-readable relative h-full w-full max-w-sm animate-slide-in-right overflow-y-auto">
        {/* 顶栏:tab 即标题 + 关闭 */}
        <div className="sticky top-0 z-10 flex items-center justify-between gap-2 px-5 py-3 border-b border-white/20 bg-[inherit]">
          <div
            role="tablist"
            aria-label="设置分类"
            onKeyDown={onTablistKeyDown}
            className="flex gap-1"
          >
            {tabs.map((t) => (
              <button
                key={t.id}
                id={`tab-${t.id}`}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                aria-controls={`panel-${t.id}`}
                onClick={() => setTab(t.id)}
                className={`px-3 py-1 rounded-full text-xs transition ${
                  tab === t.id
                    ? 'bg-white/25 text-white'
                    : 'text-white/60 hover:bg-white/15'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="关闭"
            className="w-8 h-8 rounded-full bg-white/20 text-white/80 hover:bg-white/40 flex items-center justify-center"
          >
            ×
          </button>
        </div>

        <div className="px-5 py-4">
          <div
            id="panel-add"
            role="tabpanel"
            aria-labelledby="tab-add"
            hidden={tab !== 'add'}
            className="space-y-6"
          >
            <AddPane pageId={pageId} existingTypeIds={existingTypeIds} />
          </div>
          <div
            id="panel-layout"
            role="tabpanel"
            aria-labelledby="tab-layout"
            hidden={tab !== 'layout'}
          >
            <SettingsPane draft={draft} onApply={apply} onCommit={commit} />
          </div>
        </div>
      </aside>
    </div>
  )
}
