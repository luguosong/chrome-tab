/**
 * 更新日志的外源注册表(ADR-0020):每源 = npm 包(默认版本/发布日期源,ADR-0016)+
 * 可选 GitHub Releases 日期源 + 版本块原文来源——repo raw CHANGELOG.md(译制哈希的输入);changelogUrl
 * 缺省即「无原文源」(如 Codex:上游 CHANGELOG.md 仅一行链接、GitHub release 正文是
 * 空壳),版本流由后端从 npm time 表合成(剔 prerelease),无原文可译,详情只给外链。
 * 前后端共享:后端按它取数,前端按它取显示名与源下拉。代码即配置;
 * 需要自由输入源时再考虑。
 */
export type ChangelogSourceId = 'claude-code' | 'matt-skills' | 'codex'

export interface ChangelogSourceDef {
  id: ChangelogSourceId
  /** 图标名称行 / Drawer 标题的显示名。 */
  label: string
  /** 外源仓库主页。 */
  repositoryUrl: string
  /** npm 包名:默认以 packument 的 dist-tags.latest + time 作为版本发布信息。 */
  npmPackage: string
  /** GitHub Releases API;设置后以 tag_name/published_at 作为版本日期。 */
  githubReleasesApiUrl?: string
  /** repo raw CHANGELOG.md 地址;缺省 = 无原文源(版本流走 npm 合成,详见文件头)。 */
  changelogUrl?: string
  /** 无原文源的详情外链(GitHub Releases 列表页);有 changelogUrl 的源不设。 */
  releasesUrl?: string
}

export const CHANGELOG_SOURCES: readonly ChangelogSourceDef[] = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    repositoryUrl: 'https://github.com/anthropics/claude-code',
    npmPackage: '@anthropic-ai/claude-code',
    changelogUrl: 'https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md',
  },
  {
    id: 'matt-skills',
    label: 'Matt Skills',
    repositoryUrl: 'https://github.com/mattpocock/skills',
    npmPackage: 'mattpocock-skills',
    githubReleasesApiUrl: 'https://api.github.com/repos/mattpocock/skills/releases?per_page=100',
    changelogUrl: 'https://raw.githubusercontent.com/mattpocock/skills/main/CHANGELOG.md',
  },
  {
    id: 'codex',
    label: 'Codex',
    repositoryUrl: 'https://github.com/openai/codex',
    npmPackage: '@openai/codex',
    releasesUrl: 'https://github.com/openai/codex/releases',
  },
]

/** 存量兼容(ADR-0020):data=null 的旧更新日志图标归默认源,读侧兜底、不迁移。 */
export const DEFAULT_CHANGELOG_SOURCE: ChangelogSourceId = 'claude-code'

/** 图标 data → 源 id:data.source 非法/缺失(含存量 null)回落默认源。 */
export function changelogSourceOf(
  data: Record<string, unknown> | null | undefined,
): ChangelogSourceId {
  const s = data?.['source']
  return typeof s === 'string' && CHANGELOG_SOURCES.some((d) => d.id === s)
    ? (s as ChangelogSourceId)
    : DEFAULT_CHANGELOG_SOURCE
}

/** 按源 id 查定义;未知回落默认源定义(与 DEFAULT 常量同源,数组重排不致分叉)。 */
export function getChangelogSource(id: ChangelogSourceId): ChangelogSourceDef {
  return (
    CHANGELOG_SOURCES.find((d) => d.id === id) ??
    CHANGELOG_SOURCES.find((d) => d.id === DEFAULT_CHANGELOG_SOURCE)!
  )
}
