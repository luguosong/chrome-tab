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
    <div>
      <div className="text-4xl font-bold tracking-tight leading-none text-gray-800 dark:text-zinc-100">
        {time}
      </div>
      <small className="block text-sm text-gray-500 dark:text-zinc-400 mt-1">
        {now.getFullYear()}年{now.getMonth() + 1}月{now.getDate()}日 周{w}
      </small>
    </div>
  )
}
