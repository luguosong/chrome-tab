import { useIconData } from '../context/IconDataContext'
import { useLayoutSettings } from '../context/LayoutSettingsContext'
import { inline } from '../lib/changelogParser'
import type { ChangelogVersion } from '../lib/changelogParser'
import { get } from '../lib/iconTypeRegistry'
import type { Icon } from '../lib/types'

/**
 * 更新日志图标的专属网格渲染(单例、仅 large 3×2;ADR-0012 图标层换肤为小组件式版本列表)。
 *
 * 与 stock/weather 同范式:由 Icon.tsx 作为外壳在 type==='changelog' 时委托调用。
 * 数据来自 IconDataContext 集中下发的 changelog(与 ChangelogDrawer 同源,零额外请求)。
 * 排版:iOS 小组件信息层级 —— 顶部小标签 + 最近 3 个版本(版本号 accent 大字 + 首条
 * 更新项截断),无数据降级占位行。字号随 iconScale 同比缩放(px(n)=n×iconScale)。
 */
export default function ChangelogIconBody({ icon: _icon }: { icon: Icon }) {
  const { changelog } = useIconData()
  const { iconScale } = useLayoutSettings()
  const px = (n: number) => n * iconScale

  const versions = changelog?.slice(0, 3) ?? null

  return (
    <div className="w-full flex flex-col gap-1.5">
      <div className="uppercase tracking-wider text-white/60 truncate" style={{ fontSize: px(10) }}>
        {get('changelog')?.label ?? '更新日志'}
      </div>
      {versions ? (
        versions.map((v, i) => <VersionRow key={i} v={v} px={px} />)
      ) : (
        // 加载中/失败降级:占位行(与旧摘要行 "--" 降级语义一致)
        <span className="font-mono text-white/40" style={{ fontSize: px(12) }}>
          --
        </span>
      )}
    </div>
  )
}

/** 单版本行:版本号(accent,inline markdown 同 Drawer)+ 首条更新项截断。 */
function VersionRow({ v, px }: { v: ChangelogVersion; px: (n: number) => number }) {
  const first = v.top[0] ?? v.sections.flatMap((s) => s.items)[0] ?? null
  return (
    <div className="min-w-0">
      <div
        className="font-mono text-accent truncate"
        style={{ fontSize: px(12) }}
        dangerouslySetInnerHTML={{ __html: inline(v.title) }}
      />
      {first && (
        <div
          className="text-white/75 truncate"
          style={{ fontSize: px(11) }}
          dangerouslySetInnerHTML={{ __html: inline(first) }}
        />
      )}
    </div>
  )
}
