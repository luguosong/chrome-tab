/**
 * 更新日志的外源注册表(ADR-0020):每源 = npm 包(默认版本/发布日期源,ADR-0016)+
 * 可选 GitHub Releases 源 + 版本块原文来源(译制哈希的输入)——原文两形态(ADR-0050):
 * repo raw CHANGELOG.md 直取(changelogUrl),或 GitHub Releases 正文合成(githubReleasesApiUrl,
 * 如 Codex:上游 CHANGELOG.md 是一行链接的存根,release 正文预发布为空壳、正式版完整)。
 * 两地址皆缺省即「无原文源」:版本流由后端从 npm time 表合成(剔 prerelease),
 * 无原文可译,详情只给外链。
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
  /** GitHub Releases API;设置后以 tag_name/published_at 作为版本日期,且兼作
   *  合成原文源(无 changelogUrl 时由后端从 release 正文合成版本块,ADR-0050)。 */
  githubReleasesApiUrl?: string
  /** repo raw CHANGELOG.md 地址;缺省且配了 githubReleasesApiUrl = 合成原文源
   *  (见文件头);两者皆缺省 = 无原文源(版本流走 npm 合成,详见文件头)。 */
  changelogUrl?: string
  /** 无原文源的详情外链(GitHub Releases 列表页);有原文的源不设。 */
  releasesUrl?: string
}

/** 稳定版号形态:纯数字段(0.152.0)。非此形态即预发布(alpha 等)——后端 npm 合成
 *  剔元键(created/modified)与预发布、前端块内滚动榜过滤预发布,同源一份判断。 */
const STABLE_VERSION_RE = /^\d+(\.\d+)*$/

/** 版本号是否预发布(0.152.0-alpha.6 / created 等非稳定形态)。 */
export function isPrereleaseVersion(version: string): boolean {
  return !STABLE_VERSION_RE.test(version)
}

/** 源是否有版本块正文(直取或合成)——「有无原文」判别轴单点(ADR-0050):后端译制
 *  窗口与前端 noRaw(GitHub 外链降级臂)共用,changelogUrl 单字段不再是判别轴。 */
export function hasChangelogRaw(def: ChangelogSourceDef): boolean {
  return def.changelogUrl != null || def.githubReleasesApiUrl != null
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
    githubReleasesApiUrl: 'https://api.github.com/repos/openai/codex/releases?per_page=100',
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
