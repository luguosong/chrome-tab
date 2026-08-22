import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useQuotes } from '../hooks/useQuotes'
import { useChangelog } from '../hooks/useChangelog'
import { useWeather } from '../hooks/useWeather'
import type { ChangelogVersion } from '../lib/changelogParser'
import type { Quote } from '../lib/quoteParser'
import { locationKey, readWeatherLocation, type WeatherBundle, type WeatherLocation } from '../lib/weather'
import type { Icon } from '../lib/types'

/**
 * 实时数据统一拉取层(spec §刷新策略)。
 *
 * useQuotes 的 queryKey 是 ['quotes', symbols]。若每个 stock 图标各自调 useQuotes,会切成
 * N 个独立 query(每个独立 <script> + 60s 轮询)。因此在 DashboardPage 顶层收集所有图标
 * 的 symbol → 一次性拉取 → 通过 Context 下发;changelog 同理(单例,集中在 Context 拉取
 * 使未来多页常驻挂载不会重复触发)。weather 同理(ADR-0009):收集所有天气图标的 location
 * → 一次批量 /api/weather → 下发,避免 N 个图标各自 N×3 请求。
 *
 * 下发 error 与 refetch 是为详情面板的「刷新失败,重试」(spec user story 15):
 * stock Modal 用 quotesError/refetchQuotes,changelog Drawer 用 changelogError/refetchChangelog,
 * weather Modal 用 weatherError/refetchWeather。
 */
interface IconDataValue {
  quotes: Record<string, Quote | null>
  changelog: ChangelogVersion[] | null
  /** 已有译文的版本号(ADR-0017),Drawer 对其余版本渲染「翻译」按钮。 */
  changelogTranslated: string[]
  weather: Record<string, WeatherBundle | null>
  quotesError: Error | null
  changelogError: Error | null
  weatherError: Error | null
  refetchQuotes: () => void
  refetchChangelog: () => void
  refetchWeather: () => void
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

  // 收集所有天气图标的 location(按 locationKey 去重,稳 queryKey)
  const weatherLocs = useMemo(() => {
    const out: WeatherLocation[] = []
    const seen = new Set<string>()
    for (const i of icons) {
      if (i.type === 'weather') {
        const loc = readWeatherLocation(i.data)
        if (loc) {
          const k = locationKey(loc)
          if (!seen.has(k)) {
            seen.add(k)
            out.push(loc)
          }
        }
      }
    }
    return out
  }, [icons])

  const quotesQ = useQuotes(symbols)
  const changelogQ = useChangelog()
  const weatherQ = useWeather(weatherLocs)

  const value = useMemo<IconDataValue>(
    () => ({
      quotes: quotesQ.data ?? {},
      changelog: changelogQ.data?.versions ?? null,
      changelogTranslated: changelogQ.data?.translatedVersions ?? [],
      weather: weatherQ.data ?? {},
      quotesError: quotesQ.isError ? (quotesQ.error as Error) : null,
      changelogError: changelogQ.isError ? (changelogQ.error as Error) : null,
      weatherError: weatherQ.isError ? (weatherQ.error as Error) : null,
      refetchQuotes: () => {
        void quotesQ.refetch()
      },
      refetchChangelog: () => {
        void changelogQ.refetch()
      },
      refetchWeather: () => {
        void weatherQ.refetch()
      },
    }),
    // 注意:不把各 query 整体列入依赖(每渲染新身份,使 memo 失效);只列被读取的字段。
    // refetch 函数引用稳定(react-query 保证)。
    [
      quotesQ.data,
      quotesQ.isError,
      quotesQ.error,
      quotesQ.refetch,
      changelogQ.data,
      changelogQ.isError,
      changelogQ.error,
      changelogQ.refetch,
      weatherQ.data,
      weatherQ.isError,
      weatherQ.error,
      weatherQ.refetch,
    ],
  )

  return <IconDataContext.Provider value={value}>{children}</IconDataContext.Provider>
}

/** Icon 组件用:取实时行情映射 + changelog + weather。Provider 外调用返回空数据(降级 "--")。 */
export function useIconData(): IconDataValue {
  return (
    useContext(IconDataContext) ?? {
      quotes: {},
      changelog: null,
      changelogTranslated: [],
      weather: {},
      quotesError: null,
      changelogError: null,
      weatherError: null,
      refetchQuotes: () => {},
      refetchChangelog: () => {},
      refetchWeather: () => {},
    }
  )
}
