import { isPrereleaseVersion } from 'chrome-tab-shared'

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

/** 「最新稳定版」= 列表序中首个稳定版号(ADR-0050 稳定轴):全览位列表含预发布占位
 *  行,但「最新」只认正式版——同一源对「最新」只给一个答案;Modal 副标题/「最新」
 *  药丸与图标块内榜首共用。
 *  跨层协议:依赖后端列表序 = 源声明排序轴(shared sortAxis)降序,直取源信上游文件
 *  惯例(通常同轴)。曾考虑后端透传 ReleaseInfo.latest 消除协议——否决:改 API 契约
 *  + 快照落库的面,且推算语义与渲染天然一致(latest 必在列表中);若上游文件序乱掉
 *  的事故发生再升级。 */
export function latestStableTitle(versions: readonly { title: string }[]): string | undefined {
  return versions.find((v) => !isPrereleaseVersion(v.title))?.title
}
