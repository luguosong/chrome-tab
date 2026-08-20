import type { Config, LayoutSettings } from '../types'

/**
 * 备份文件 schema 版本;结构变更时递增。
 * v2(ADR-0011):icons 增 id(客户端键)与 parentId(分组成员指向组行,顶层为 null)。
 * v3(ADR-0016):icons 删 size(图标单档化,无尺寸概念)。
 * 导入接受 v1/v2/v3(v1 无 id/parentId,解析时按 null 兼容;v2 的 size 为多余字段,
 * 后端 Jackson 忽略,不写文件转换器)。
 */
export const BACKUP_SCHEMA_VERSION = 3

/** 兼容 v1/v2 的导入行(v1 无 id/parentId);仅 parseBackupPayload 内部使用。 */
type V1OrV2Icon = Omit<WireConfig['icons'][number], 'id' | 'parentId'> &
  Partial<Pick<WireConfig['icons'][number], 'id' | 'parentId'>>

/**
 * PUT /api/config 请求体(后端 ConfigReplaceService.ReplaceRequest)。
 * pages/icons 都带 id(客户端键,可来自服务端或离线临时,服务端整体重建重分配);
 * icons.parentId 引用某 GROUP 行的 id,顶层为 null(ADR-0011);
 * type 为大写枚举名(对齐 GET 输出);layoutSettings 可空。
 */
export type WireConfig = {
  pages: { id: number; name: string; sortOrder: number }[]
  icons: {
    id: number
    pageId: number
    parentId: number | null
    type: string
    sortOrder: number
    data: Record<string, unknown> | null
  }[]
  /** Partial:导出恒为全量(经 withDefaults);导入旧备份可能只有旧三字段,缺项由后端落默认。 */
  layoutSettings: Partial<LayoutSettings> | null
}

/** 把前端归一化 Config(小写枚举)转 PUT wire 格式(大写枚举)。导出/推送/导入合并共用。 */
export function toWireConfig(c: Config): WireConfig {
  return {
    pages: c.pages.map((p) => ({ id: p.id, name: p.name, sortOrder: p.sortOrder })),
    icons: c.icons.map((i) => ({
      id: i.id,
      pageId: i.pageId,
      parentId: i.parentId,
      type: i.type.toUpperCase(),
      sortOrder: i.sortOrder,
      data: i.data,
    })),
    layoutSettings: c.layoutSettings ? { ...c.layoutSettings } : null,
  }
}

export type BackupPayload = {
  schemaVersion: number
  exportedAt: string
  config: WireConfig
}

/** 导出:配置 → 备份 payload(含 schemaVersion + 导出时间)。恒为当前 BACKUP_SCHEMA_VERSION。 */
export function toBackupPayload(c: Config): BackupPayload {
  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    config: toWireConfig(c),
  }
}

/**
 * 解析导入文件:接受 v1/v2/v3,失败抛 Error(调用方转用户提示)。
 * v1(无组时代)在内存中最小升级:icons 按序补客户端 id、parentId=null;不改写原文件。
 * v2 的 size 字段(ADR-0016 前)为多余属性:「完全替换」路径原样透传由后端 Jackson 忽略,
 * 「合并」路径(mergeBlobs 逐字段重建)自然丢弃。
 */
export function parseBackupPayload(raw: unknown): BackupPayload {
  if (typeof raw !== 'object' || raw === null) throw new Error('文件格式不正确')
  const r = raw as Record<string, unknown>
  if (![1, 2, BACKUP_SCHEMA_VERSION].includes(r.schemaVersion as number))
    throw new Error('备份版本不兼容(schemaVersion=' + String(r.schemaVersion) + ')')
  const cfg = (r.config ?? null) as Record<string, unknown> | null
  if (!cfg || !Array.isArray(cfg.pages) || !Array.isArray(cfg.icons))
    throw new Error('备份缺少 pages/icons')
  if (r.schemaVersion === 1) {
    cfg.icons = (cfg.icons as V1OrV2Icon[]).map((i, idx) => ({
      parentId: null,
      ...i,
      id: i.id ?? idx + 1,
    }))
  }
  return raw as BackupPayload
}

/**
 * 合并:v1 不做语义去重(ADR-0006 / Q9)——导入项整体重键后追加到当前 blob 末尾。
 * 导入页分配新 id(现有最大 id 之后),导入 icon 的 pageId 随之重映射;
 * 导入 icon 同样分配新 id(现有最大 icon id 之后),成员的 parentId 经 iconIdMap
 * 随之重映射到导入集合内的新组行 id(引用集合外的组 → 跳过该行,照 pageId 先例)。导入布局忽略。
 */
export function mergeBlobs(current: Config, imported: WireConfig): WireConfig {
  const maxExistingPageId = current.pages.reduce((m, p) => Math.max(m, p.id), 0)
  const maxExistingIconId = current.icons.reduce((m, i) => Math.max(m, i.id), 0)
  const remap = new Map<number, number>()
  const pages = current.pages.map((p) => ({ id: p.id, name: p.name, sortOrder: p.sortOrder }))
  let nextPageId = maxExistingPageId + 1
  for (const p of imported.pages) {
    const nid = nextPageId++
    remap.set(p.id, nid)
    pages.push({ id: nid, name: p.name, sortOrder: p.sortOrder })
  }
  const icons = current.icons.map((i) => ({
    id: i.id,
    pageId: i.pageId,
    parentId: i.parentId,
    type: i.type.toUpperCase(),
    sortOrder: i.sortOrder,
    data: i.data,
  }))
  // 第一遍:导入 icon 分配新 id,建 iconIdMap(组行与成员都要建)
  const iconRemap = new Map<number, number>()
  let nextIconId = maxExistingIconId + 1
  for (const i of imported.icons) {
    iconRemap.set(i.id, nextIconId++)
  }
  // 第二遍:输出导入行(pageId/iconId 双重映射;任一引用不在导入集合内 → 跳过该行,照 pageId 先例)
  for (const i of imported.icons) {
    const pid = remap.get(i.pageId)
    if (pid == null) continue // 引用了未导入的页 → 跳过
    let newParent: number | null = null
    if (i.parentId != null) {
      newParent = iconRemap.get(i.parentId) ?? null
      if (newParent == null) continue // 引用了未导入的组 → 跳过
    }
    icons.push({
      id: iconRemap.get(i.id)!,
      pageId: pid,
      parentId: newParent,
      type: i.type.toUpperCase(),
      sortOrder: i.sortOrder,
      data: i.data,
    })
  }
  return {
    pages,
    icons,
    layoutSettings: current.layoutSettings ? { ...current.layoutSettings } : null,
  }
}
