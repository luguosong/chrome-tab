import { useEffect, useState } from 'react'

export default function Clock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 10_000) // 10s：分钟级精度足够
    return () => clearInterval(t)
  }, [])
  const time = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  const w = '日一二三四五六'[now.getDay()]
  return (
    <div className="text-center text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.5)]">
      <div className="text-7xl font-light tracking-tight leading-none tabular-nums">
        {time}
      </div>
      <small className="block text-base font-light mt-2 opacity-90">
        {now.getFullYear()}年{now.getMonth() + 1}月{now.getDate()}日 周{w}
      </small>
    </div>
  )
}
