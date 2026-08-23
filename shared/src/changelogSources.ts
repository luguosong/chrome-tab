/**
 * 更新日志的外源注册表(ADR-0020):每源 = npm 包(版本列表与发布日期的权威源,
 * ADR-0016)+ repo raw CHANGELOG.md(版本块原文,译制哈希的输入)。
 * 前后端共享:后端按它取数,前端按它取显示名与源下拉。枚举两源、代码即配置;
 * 第三个真实外源出现时再考虑自由输入。
 */
export type ChangelogSourceId = 'claude-code' | 'matt-skills'

export interface ChangelogSourceDef {
  id: ChangelogSourceId
  /** 图标名称行 / Drawer 标题的显示名。 */
  label: string
  /** npm 包名:packument 的 dist-tags.latest + time[latest] = 最新版号与发布日期。 */
  npmPackage: string
  /** repo raw CHANGELOG.md 地址。 */
  changelogUrl: string
}

export const CHANGELOG_SOURCES: readonly ChangelogSourceDef[] = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    npmPackage: '@anthropic-ai/claude-code',
    changelogUrl: 'https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md',
  },
  {
    id: 'matt-skills',
    label: 'Matt Skills',
    npmPackage: 'mattpocock-skills',
    changelogUrl: 'https://raw.githubusercontent.com/mattpocock/skills/main/CHANGELOG.md',
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
