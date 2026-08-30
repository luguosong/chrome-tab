import type { Config } from '../types'

/**
 * 本地镜像记录(ADR-0006)。config 为归一化后的完整配置;updatedAt 为"上次服务端确认时间"
 * (服务端在每次写时回传,离线期间不前进);dirty 标记本地有尚未推送到服务端的改动。
 */
export type MirrorRecord = {
  config: Config
  updatedAt: string | null
  dirty: boolean
}

export type ReconcileAction = 'pull' | 'push' | 'none' | 'conflict'

/** QueryCache 事件 action 的最小形状(manual = TanStack 对手动写的标记)。 */
export type CacheUpdateAction = { type: string; manual?: boolean }

/**
 * 缓存订阅事件是否「网络拉取成功」——内容为服务端权威,可落盘 clean 镜像。
 * TanStack v5 契约:setQueryData(乐观写/还原快照)派发的同样是 type:'success',
 * 仅以 manual:true 区分手动写——判 type 不判 manual 会把未验证的乐观数据当权威
 * 落盘(ADR-0006「在线写入先到服务端、成功后回写本地镜像」;行为契约由
 * reconcile.test 锁)。例外:和解回填与离线镜像喂缓存虽是手动写,其持久化由
 * ConfigSyncProvider.reconcile 内显式 saveMirror 保证,不经缓存订阅路径。
 */
export function isAuthoritativeCacheUpdate(action: CacheUpdateAction): boolean {
  return action.type === 'success' && action.manual !== true
}

/**
 * 把服务端 ISO 时间戳(可能带纳秒小数)归一为可比的 epoch 毫秒;null/非法 → -∞(最旧)。
 * 截到秒级避免纳秒小数导致 Date 解析歧义;LWW 只需稳定序,秒级足够(写间隔通常 ≫ 1s)。
 */
export function tsValue(iso: string | null | undefined): number {
  if (!iso) return -Infinity
  const secs = iso.slice(0, 19) // 2026-08-12T10:30:00
  const t = new Date(secs).getTime()
  return Number.isNaN(t) ? -Infinity : t
}

/**
 * 整体-blob LWW 和解决策(ADR-0006)。
 *  - local 空                              → pull(浏览器清空/首跑,从服务端拉)。
 *  - local 非空 且 服务端无版本(null=丢失/空) → push(服务端丢失,用本地恢复)。
 *  - local 脏:
 *      服务端未更新(≤ local) → push(离线编辑重连推送)。
 *      服务端更新(> local)   → conflict(另一端改过:服务端赢,本地留底)。
 *  - local 干净:
 *      服务端更新(> local) → pull(另一设备改过)。
 *      否则                 → none。
 */
export function decideReconciliation(
  local: MirrorRecord | null,
  serverUpdatedAt: string | null,
): ReconcileAction {
  if (!local) return 'pull'
  // 服务端无版本行(丢失/重置空)而本地有数据 → 用本地恢复。
  if (serverUpdatedAt == null && local.config.pages.length > 0) return 'push'

  const lt = tsValue(local.updatedAt)
  const st = tsValue(serverUpdatedAt)
  if (local.dirty) return st > lt ? 'conflict' : 'push'
  return st > lt ? 'pull' : 'none'
}
