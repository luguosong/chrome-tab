import { useEffect, useState } from 'react'
import type { IconTypeId, LayoutSettings } from '../lib/types'
import { useLayoutDraft } from '../hooks/useLayoutDraft'
import { AddPane } from './AddDrawer'
import { SettingsPane } from './SettingsDrawer'
import { AccountPane } from './AccountPane'

/**
 * 控制抽屉(见 CONTEXT.md「新增抽屉」/「布局草稿」):右上角 ⚙ 唤起的统一侧抽屉,
 * tab 切换「新增 / 布局 / 账号」三块内容(原 AddDrawer + SettingsDrawer 合并,壳唯一;
 * 账号 pane 承接原顶栏的用户信息与登出)。
 *
 * tab 用原生 hidden 切换:各 pane 保持挂载,新增表单半填内容 / 布局草稿切 tab 不丢,
 * 且 hidden 子树自动移出焦点链。布局草稿由 useLayoutDraft 持有:关闭(Esc/遮罩/×)前
 * flush 落库是松手 commit 之外的兜底,脏门控避免无谓 PUT(协议见 lib/layoutDraft.ts)。
 *
 * 容器与原 AddDrawer 同构:fixed 右侧、滑入、玻璃面板、sticky 顶栏(tab 栏 + 关闭)。
 */
type Tab = 'add' | 'layout' | 'account'

export default function ControlDrawer({
  pageId,
  existingTypeIds,
  layout,
  onClose,
  onEnterEdit,
}: {
  /** 当前激活页 id——新图标落到此页末尾。undefined 时禁用提交(无页可加)。 */
  pageId: number | undefined
  /** 当前用户全部图标出现的类型集合——用于单例置灰判断(单例=全局唯一,跨页)。 */
  existingTypeIds: IconTypeId[]
  layout: LayoutSettings
  onClose: () => void
  /** 「布局」tab 的显式编辑入口:关抽屉 + 进编辑模式(调用方接线)。 */
  onEnterEdit: () => void
}) {
  const [tab, setTab] = useState<Tab>('add')

  // 布局草稿:slider 受控源,apply 乐观写缓存实时预览,commit 松手/关闭落库。
  const { draft, apply, commit } = useLayoutDraft(layout)

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

  // tablist 箭头键切换(WAI-ARIA tabs 模式):按 tabs 序循环,左右移动并聚焦
  const tabs: { id: Tab; label: string }[] = [
    { id: 'add', label: '新增' },
    { id: 'layout', label: '布局' },
    { id: 'account', label: '账号' },
  ]

  function onTablistKeyDown(e: React.KeyboardEvent) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const i = tabs.findIndex((t) => t.id === tab)
    const step = e.key === 'ArrowRight' ? 1 : tabs.length - 1
    const next = tabs[(i + step) % tabs.length]
    setTab(next.id)
    document.getElementById(`tab-${next.id}`)?.focus()
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="设置"
    >
      {/* 遮罩:点击关闭;与面板滑入同步淡入 */}
      <div className="absolute inset-0 bg-black/40 animate-fade-in" onClick={close} />

      <aside className="glass-panel glass-panel-readable relative h-full w-full max-w-sm animate-slide-in-right overflow-y-auto rounded-l-3xl">
        {/* 顶栏:tab 即标题 + 关闭。半透明底 + 自身 blur,滚动内容从栏下柔透(iOS nav 栏) */}
        <div className="sticky top-0 z-10 flex items-center gap-3 px-5 py-3 border-b border-white/10 bg-white/35 backdrop-blur-md dark:bg-[#101012]/55">
          {/* 分段控件(签名元素):凹轨 + 凸起玻璃滑块,等宽三段,滑块随选中滑动。
              tab py-2(命中高 32px)+ 焦点环对齐全站语汇;滑块 top-1 bottom-1 自适应不受影响 */}
          <div
            role="tablist"
            aria-label="设置分类"
            onKeyDown={onTablistKeyDown}
            className="relative grid flex-1 grid-cols-3 rounded-full bg-white/[0.07] p-1"
          >
            <span
              aria-hidden
              className="glass-segment-thumb absolute top-1 bottom-1 left-1 rounded-full transition-transform duration-200"
              style={{
                width: 'calc((100% - 8px) / 3)',
                transform: `translateX(${tabs.findIndex((t) => t.id === tab) * 100}%)`,
              }}
            />
            {tabs.map((t) => (
              <button
                key={t.id}
                id={`tab-${t.id}`}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                aria-controls={`panel-${t.id}`}
                onClick={() => setTab(t.id)}
                className={`relative z-10 rounded-full py-2 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-white/60 ${
                  tab === t.id ? 'text-white' : 'text-white/55 hover:text-white/85'
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
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-white/70 transition hover:bg-white/25 hover:text-white focus-visible:outline-2 focus-visible:outline-white/60"
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
            <SettingsPane draft={draft} onApply={apply} onCommit={commit} onEnterEdit={onEnterEdit} />
          </div>
          <div
            id="panel-account"
            role="tabpanel"
            aria-labelledby="tab-account"
            hidden={tab !== 'account'}
          >
            <AccountPane />
          </div>
        </div>
      </aside>
    </div>
  )
}
