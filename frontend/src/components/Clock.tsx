import { useEffect, useState } from 'react'

/** 顶部时钟:iOS 锁屏式大字裸排(不上玻璃),双层 text-shadow 保可读 —— 暗晕压住
 *  亮壁纸 + 1px 白光提字重(原型 prototype/liquid-glass @3f10ddf 定稿)。 */
export default function Clock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 10_000) // 10s：分钟级精度足够
    return () => clearInterval(t)
  }, [])
  const time = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  const w = '日一二三四五六'[now.getDay()]
  return (
    <div
      className="text-white select-none"
      style={{ textShadow: '0 2px 12px rgba(0,0,0,0.45), 0 0 1px rgba(255,255,255,0.25)' }}
    >
      <div className="text-5xl font-light tracking-tight leading-none tabular-nums">
        {time}
      </div>
      <small className="block text-xs font-light mt-1 opacity-85">
        {now.getMonth() + 1}月{now.getDate()}日 周{w}
      </small>
    </div>
  )
}
