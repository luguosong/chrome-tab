export type ChangelogSection = { name: string; items: string[] }
export type ChangelogVersion = { title: string; sections: ChangelogSection[]; top: string[] }

/**
 * 解析 CHANGELOG.md：## = 版本，### = 小节，-/* = 条目。
 * 小节之外的条目归 top（个别版本直接列要点无 ###）。
 */
export function parseChangelog(md: string): ChangelogVersion[] {
  const out: ChangelogVersion[] = []
  let ver: ChangelogVersion | null = null
  const flush = () => {
    if (ver) out.push(ver)
  }
  for (const raw of md.split('\n')) {
    const line = raw.replace(/\r/, '')
    const h = line.match(/^##\s+(.+)/)
    if (h) {
      flush()
      ver = { title: h[1].trim(), sections: [], top: [] }
      continue
    }
    const h3 = line.match(/^###\s+(.*)/)
    if (h3 && ver) {
      ver.sections.push({ name: h3[1].trim(), items: [] })
      continue
    }
    const li = line.match(/^[-*]\s+(.*)/)
    if (li && ver) {
      const sec = ver.sections[ver.sections.length - 1]
      ;(sec ? sec.items : ver.top).push(li[1])
    }
  }
  flush()
  return out
}

/** HTML 转义：& < > " ' 全覆盖。
 *  引号一并转义，使 inline() 生成的 href="..." 属性无法被内容里的引号越权注入（属性注入/XSS 根因）。 */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** 极简行内 markdown：行内代码 / 加粗 / 链接。先转义再格式化。
 *  构造上即安全：仅产出硬编码的 <code>/<strong>/<a>，文本已全转义；
 *  href 强制 https?: 前缀（挡 javascript:），且引号已转义无法逃出属性。 */
export function inline(s: string): string {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
}
