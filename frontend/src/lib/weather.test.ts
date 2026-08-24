import { describe, expect, it } from 'vitest'
import { hourlyWindow, type WeatherHour } from './weather'

// hourlyWindow 是天气 3×1 图标小时序列的取窗口径(纯函数,注入 now 可直测,同 timeAgo 范式):
// 后端 hourly 缓存 30min,过整点后短时间内首位仍是上一小时——按当前整点过滤滞留条目,
// 使「现在」标签永远落在真正当前的小时上(CONTEXT.md「天气」)。
// fxTime 为和风 ISO 串(城市当地时间,带偏移;比较用绝对时刻,显示用字符串直取)。
const NOW = new Date('2026-08-24T15:20:00+08:00')

const hour = (iso: string, temp = 30): WeatherHour => ({
  fxTime: iso,
  temp,
  icon: '100',
  text: '晴',
})

describe('hourlyWindow', () => {
  it('丢弃早于当前整点的滞留条目,当前小时起取前 4 条', () => {
    const hourly = [
      hour('2026-08-24T14:00+08:00', 31), // 缓存滞留的上一小时 → 丢
      hour('2026-08-24T15:00+08:00', 32), // 当前小时,居首
      hour('2026-08-24T16:00+08:00', 29),
      hour('2026-08-24T17:00+08:00', 27),
      hour('2026-08-24T18:00+08:00', 26),
      hour('2026-08-24T19:00+08:00', 25), // 超出 4 条 → 截断
    ]
    const w = hourlyWindow(hourly, NOW)
    expect(w.map((h) => h.fxTime)).toEqual([
      '2026-08-24T15:00+08:00',
      '2026-08-24T16:00+08:00',
      '2026-08-24T17:00+08:00',
      '2026-08-24T18:00+08:00',
    ])
  })

  it('首位恰为当前整点(边界含)= 保留', () => {
    const hourly = [hour('2026-08-24T15:00+08:00'), hour('2026-08-24T16:00+08:00')]
    expect(hourlyWindow(hourly, NOW)).toHaveLength(2)
  })

  it('全部早于当前整点 → 空窗(调用方降级实况摘要)', () => {
    expect(hourlyWindow([hour('2026-08-24T13:00+08:00')], NOW)).toEqual([])
  })

  it('fxTime 空/非法的条目跳过(上游可空,Modal 同款防御)', () => {
    const hourly = [
      { ...hour('2026-08-24T15:00+08:00'), fxTime: '' },
      hour('2026-08-24T16:00+08:00'),
    ]
    expect(hourlyWindow(hourly, NOW).map((h) => h.fxTime)).toEqual(['2026-08-24T16:00+08:00'])
  })

  it('hourly 缺失(undefined)→ 空窗', () => {
    expect(hourlyWindow(undefined, NOW)).toEqual([])
  })
})
