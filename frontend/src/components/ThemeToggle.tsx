import { useConfig, useUpdateSetting } from '../api/config'

const OPTIONS = [
  { key: 'light', label: '浅' },
  { key: 'system', label: '自动' },
  { key: 'dark', label: '深' },
] as const

export default function ThemeToggle() {
  const { data } = useConfig()
  const update = useUpdateSetting()
  const cur = data?.setting.theme ?? 'system'
  return (
    <div className="inline-flex border border-gray-200 dark:border-zinc-700 rounded-md overflow-hidden text-xs">
      {OPTIONS.map((o) => (
        <button
          key={o.key}
          onClick={() => update.mutate(o.key)}
          className={
            cur === o.key
              ? 'px-2.5 py-1 bg-accent text-white'
              : 'px-2.5 py-1 text-gray-500 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-800'
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
