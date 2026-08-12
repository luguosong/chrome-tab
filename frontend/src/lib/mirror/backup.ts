import type { Config } from '../types'

/** 备份文件 schema 版本;结构变更时递增,旧文件导入时 parseBackupPayload 拒绝。 */
export const BACKUP_SCHEMA_VERSION = 1

/**
 * PUT /api/config 请求体(后端 ConfigReplaceService.ReplaceRequest)。
 * pages 带 id(客户端键,可来自服务端或离线临时);icons 无 id(整体重建重排);
 * type/size 为大写枚举名(对齐 GET 输出);layoutSettings 可空。
 */
export type WireConfig = {
  pages: { id: number; name: string; sortOrder: number }[]
  icons: {
    pageId: number
    type: string
    size: string
    sortOrder: number
    data: Record<string, unknown> | null
  }[]
  layoutSettings: { gridWidth: number; gridGap: number; iconScale: number } | null
}

/** 把前端归一化 Config(小写枚举)转 PUT wire 格式(大写枚举)。导出/推送/导入合并共用。 */
export function toWireConfig(c: Config): WireConfig {
  return {
    pages: c.pages.map((p) => ({ id: p.id, name: p.name, sortOrder: p.sortOrder })),
    icons: c.icons.map((i) => ({
      pageId: i.pageId,
      type: i.type.toUpperCase(),
      size: i.size.toUpperCase(),
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

/** 导出:配置 → 备份 payload(含 schemaVersion + 导出时间)。 */
export function toBackupPayload(c: Config): BackupPayload {
  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    config: toWireConfig(c),
  }
}

/** 解析导入文件:校验 schemaVersion 与基本结构,失败抛 Error(调用方转用户提示)。 */
export function parseBackupPayload(raw: unknown): BackupPayload {
  if (typeof raw !== 'object' || raw === null) throw new Error('文件格式不正确')
  const r = raw as Record<string, unknown>
  if (r.schemaVersion !== BACKUP_SCHEMA_VERSION)
    throw new Error('备份版本不兼容(schemaVersion=' + String(r.schemaVersion) + ')')
  const cfg = (r.config ?? null) as Record<string, unknown> | null
  if (!cfg || !Array.isArray(cfg.pages) || !Array.isArray(cfg.icons))
    throw new Error('备份缺少 pages/icons')
  return raw as BackupPayload
}

/**
 * 合并:v1 不做语义去重(ADR-0006 / Q9)——导入项整体重键后追加到当前 blob 末尾。
 * 导入页分配新 id(现有最大 id 之后),导入 icon 的 pageId 随之重映射;导入布局忽略。
 */
export function mergeBlobs(current: Config, imported: WireConfig): WireConfig {
  const maxExistingPageId = current.pages.reduce((m, p) => Math.max(m, p.id), 0)
  const remap = new Map<number, number>()
  const pages = current.pages.map((p) => ({ id: p.id, name: p.name, sortOrder: p.sortOrder }))
  let nextId = maxExistingPageId + 1
  for (const p of imported.pages) {
    const nid = nextId++
    remap.set(p.id, nid)
    pages.push({ id: nid, name: p.name, sortOrder: p.sortOrder })
  }
  const icons = current.icons.map((i) => ({
    pageId: i.pageId,
    type: i.type.toUpperCase(),
    size: i.size.toUpperCase(),
    sortOrder: i.sortOrder,
    data: i.data,
  }))
  for (const i of imported.icons) {
    const pid = remap.get(i.pageId)
    if (pid == null) continue // 引用了未导入的页 → 跳过
    icons.push({
      pageId: pid,
      type: i.type.toUpperCase(),
      size: i.size.toUpperCase(),
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
