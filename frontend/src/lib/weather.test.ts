import { describe, expect, it } from 'vitest'
import { alertBadge, weatherIconUrl, type WeatherAlert } from './weather'

// alertBadge 是 1×1 天气图标右上角预警角标的取色/取文口径(纯函数,Vitest 直测):
// 多条预警取 severity 最高(CAP:Minor< Moderate< Severe< Extreme),color 字段直用、
// 缺失按 severity 查标准色,全空兜底红(与 Modal AlertBody 同源)。
const alert = (over: Partial<WeatherAlert> = {}): WeatherAlert => ({
  id: 'a1',
  senderName: '气象台',
  severity: 'Severe',
  eventType: '暴雨',
  headline: '暴雨橙色预警',
  description: '',
  effectiveTime: null,
  expireTime: null,
  icon: null,
  color: { red: 255, green: 102, blue: 0 },
  ...over,
})

describe('alertBadge', () => {
  it('无预警 → null', () => {
    expect(alertBadge([])).toBeNull()
  })

  it('color 直用;title 取 headline', () => {
    expect(alertBadge([alert()])).toEqual({ color: 'rgb(255,102,0)', title: '暴雨橙色预警' })
  })

  it('多条并存取 severity 最高(与数组顺序无关)', () => {
    const low = alert({ severity: 'Minor', headline: '大风蓝色预警', color: { red: 0, green: 153, blue: 255 } })
    expect(alertBadge([low, alert()])?.title).toBe('暴雨橙色预警')
    expect(alertBadge([alert(), low])?.title).toBe('暴雨橙色预警')
  })

  it('color 缺失 → 按 severity 查标准色;severity 未知/缺省 → 兜底红', () => {
    expect(alertBadge([alert({ color: null, severity: 'Extreme' })])?.color).toBe('rgb(255,0,0)')
    expect(alertBadge([alert({ color: null, severity: '未知' })])?.color).toBe('rgb(255,80,80)')
    expect(alertBadge([alert({ color: null, severity: undefined })])?.color).toBe('rgb(255,80,80)')
  })

  it('headline 缺省链:eventType → 「灾害预警」', () => {
    expect(alertBadge([alert({ headline: undefined })])?.title).toBe('暴雨')
    expect(alertBadge([alert({ headline: undefined, eventType: null })])?.title).toBe('灾害预警')
  })
})

// weatherIconUrl:和风 code → Meteocons 名,精确项 + 3xx/4xx 前缀兜底(未知 → not-available)。
describe('weatherIconUrl', () => {
  it('精确项:昼夜晴、雷雨、冻雨、未知', () => {
    expect(weatherIconUrl('100')).toContain('/clear-day.svg')
    expect(weatherIconUrl('150')).toContain('/clear-night.svg')
    expect(weatherIconUrl('302')).toContain('/thunderstorms-day-rain.svg')
    expect(weatherIconUrl('313')).toContain('/sleet.svg')
    expect(weatherIconUrl('999')).toContain('/not-available.svg')
  })

  it('前缀兜底:3xx 归 rain、4xx 归 snow;空 code 空串', () => {
    expect(weatherIconUrl('306')).toContain('/rain.svg')
    expect(weatherIconUrl('401')).toContain('/snow.svg')
    expect(weatherIconUrl('')).toBe('')
    expect(weatherIconUrl(null)).toBe('')
  })
})
