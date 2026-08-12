import { del, get, set } from 'idb-keyval'
import type { MirrorRecord } from './reconcile'

/**
 * 浏览器本地镜像(ADR-0006),经 idb-keyval 存 IndexedDB。按 userId 分键:
 * 单 admin 当前无所谓,但零成本防"同浏览器多账号"串数据。登出不清(作恢复来源)。
 */
function key(uid: number, kind: 'mirror' | 'conflict' = 'mirror'): string {
  return `newtab:${kind}:u${uid}`
}

export async function loadMirror(uid: number): Promise<MirrorRecord | null> {
  return (await get<MirrorRecord>(key(uid))) ?? null
}
export async function saveMirror(uid: number, r: MirrorRecord): Promise<void> {
  await set(key(uid), r)
}
export async function loadConflict(uid: number): Promise<MirrorRecord | null> {
  return (await get<MirrorRecord>(key(uid, 'conflict'))) ?? null
}
/** 把一份分叉的本地镜像留底(冲突时服务端赢,但本地绝不静默丢)。 */
export async function saveConflict(uid: number, r: MirrorRecord): Promise<void> {
  await set(key(uid, 'conflict'), r)
}
export async function clearConflict(uid: number): Promise<void> {
  await del(key(uid, 'conflict'))
}
