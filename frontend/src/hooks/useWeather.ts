import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../api/client'
import { locationKey, type WeatherBundle, type WeatherLocation } from '../lib/weather'

/**
 * 天气批量取数(见 ADR-0009)。由 IconDataContext 收集所有天气图标的 location 一次调用,
 * 经 Context 下发(N 个图标 = 1 次批量请求,非 N×3)。
 *
 * <p>后端按 (lat,lon,endpoint) 分桶缓存(实况 10min / 空气 30min / 预警 5min);
 * 前端 staleTime 5min + 后台 10min refetchInterval,保持网格温度计新鲜又不过频。</p>
 */
export function useWeather(locations: WeatherLocation[]) {
  const keys = locations.map(locationKey)
  return useQuery<Record<string, WeatherBundle | null>>({
    queryKey: ['weather', keys],
    queryFn: () => {
      if (keys.length === 0) return {}
      const qs = keys.map((k) => `location=${encodeURIComponent(k)}`).join('&')
      return apiFetch<Record<string, WeatherBundle | null>>(`/api/weather?${qs}`)
    },
    enabled: keys.length > 0,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
    retry: 1,
  })
}

/** 城市搜索(GeoAPI 后端代理),供 LocationPicker 消歧用。空串禁用。 */
export function useWeatherLocations(q: string) {
  return useQuery<WeatherLocation[]>({
    queryKey: ['weather-locations', q],
    queryFn: () => apiFetch<WeatherLocation[]>(`/api/weather/locations?q=${encodeURIComponent(q)}`),
    enabled: q.trim().length > 0,
    staleTime: 60 * 1000,
    retry: 1,
  })
}
