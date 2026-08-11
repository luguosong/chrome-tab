import { useEffect } from 'react'

export type Theme = 'light' | 'dark' | 'system'

/** 把 theme 应用到 <html>：dark 加 .dark 类；system 跟随 prefers-color-scheme 并监听变化 */
export function useApplyTheme(theme: string) {
  useEffect(() => {
    const root = document.documentElement
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && mql.matches)
      root.classList.toggle('dark', dark)
    }
    apply()
    if (theme === 'system') {
      mql.addEventListener('change', apply)
      return () => mql.removeEventListener('change', apply)
    }
  }, [theme])
}
