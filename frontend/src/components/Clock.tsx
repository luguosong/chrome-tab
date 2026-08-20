import { useEffect, useState } from 'react'
import { useLayoutSettings } from '../context/LayoutSettingsContext'

/** 顶部时钟:iOS 锁屏式大字裸排(不上玻璃),双层 text-shadow 保可读 —— 暗晕压住
 *  亮壁纸 + 1px 白光提字重(原型 prototype/liquid-glass @3f10ddf 定稿)。
 *  字号(clockFont)与时制(clock24h)来自「布局设置」;字号只作用大字时间行,
 *  日期小行不随动。显隐由 DashboardPage 按 clockVisible 控制挂载。 */
export default function Clock() {
  const { clockFont, clock24h } = useLayoutSettings()
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 10_000) // 10s：分钟级精度足够
    return () => clearInterval(t)
  }, [])
  const time = now.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: !clock24h,
  })
  const w = '日一二三四五六'[now.getDay()]
  return (
    <div
      className="text-white select-none"
      style={{ textShadow: '0 2px 12px rgba(0,0,0,0.45), 0 0 1px rgba(255,255,255,0.25)' }}
    >
      <div
        className="font-light tracking-tight leading-none tabular-nums"
        style={{ fontSize: clockFont }}
      >
        {time}
      </div>
      <small className="block text-xs font-light mt-1 opacity-85">
        {now.getMonth() + 1}月{now.getDate()}日 周{w}
      </small>
    </div>
  )
}
