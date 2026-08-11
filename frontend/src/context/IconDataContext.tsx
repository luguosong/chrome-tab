import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useQuotes } from '../hooks/useQuotes'
import { useChangelog } from '../hooks/useChangelog'
import type { ChangelogVersion } from '../lib/changelogParser'
import type { Quote } from '../lib/quoteParser'
import type { Icon } from '../lib/types'

/**
 * 实时数据统一拉取层(spec §刷新策略)。
 *
 * useQuotes 的 queryKey 是 ['quotes', symbols]。若每个 stock 图标各自调 useQuotes,会切成
 * N 个独立 query(每个独立 <script> + 60s 轮询)。因此在 DashboardPage 顶层收集所有图标
 * 的 symbol → 一次性拉取 → 通过 Context 下发;changelog 同理(单例,集中在 Context 拉取
 * 使未来多页常驻挂载不会重复触发)。
 */
interface IconDataValue {
  quotes: Record<string, Quote | null>
  changelog: ChangelogVersion[] | null
}

const IconDataContext = createContext<IconDataValue | null>(null)

export function IconDataProvider({
  icons,
  children,
}: {
  icons: Icon[]
  children: ReactNode
}) {
  // 收集所有 stock 图标的 symbol(去重、稳定排序以稳 queryKey)
  const symbols = useMemo(() => {
    const set = new Set<string>()
    for (const i of icons) {
      if (i.type === 'stock') {
        const sym = i.data?.symbol
        if (typeof sym === 'string' && sym) set.add(sym)
      }
    }
    return [...set].sort()
  }, [icons])

  const quotesQ = useQuotes(symbols)
  const changelogQ = useChangelog()

  const value = useMemo<IconDataValue>(
    () => ({
      quotes: quotesQ.data ?? {},
      changelog: changelogQ.data ?? null,
    }),
    [quotesQ.data, changelogQ.data],
  )

  return <IconDataContext.Provider value={value}>{children}</IconDataContext.Provider>
}

/** Icon 组件用:取实时行情映射 + changelog。Provider 外调用返回空数据(降级 "--")。 */
export function useIconData(): IconDataValue {
  return useContext(IconDataContext) ?? { quotes: {}, changelog: null }
}
