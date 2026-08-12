import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from './AuthContext'
import { apiFetch } from '../api/client'
import { fetchConfigOnce } from '../api/config'
import type { Config } from '../lib/types'
import { decideReconciliation, type MirrorRecord } from '../lib/mirror/reconcile'
import { toBackupPayload, toWireConfig } from '../lib/mirror/backup'
import { downloadJson } from '../lib/mirror/download'
import {
  clearConflict,
  loadConflict,
  loadMirror,
  saveConflict,
  saveMirror,
} from '../lib/mirror/localMirror'

/**
 * 双端镜像 + 整体-blob LWW 同步编排(ADR-0006)。
 *
 * <p>职责:登录后跑一次「和解」(load 本地镜像 → fetch 服务端 → decide → pull/push/conflict/none);
 * 监听 online/offline,恢复在线重跑;订阅 ['config'] 缓存,在网络拉取成功时把权威数据落盘为 clean 镜像;
 * 渲染离线指示器与冲突留底 toast(绝不静默丢本地分叉)。</p>
 *
 * <p>v1 边界:离线为只读——离线写不在本期(需要逐 hook 的乐观回放)。恢复网络后镜像自愈。</p>
 */
type SyncState = { ready: boolean; online: boolean; conflict: boolean }
const Ctx = createContext<SyncState>({ ready: false, online: true, conflict: false })
export const useConfigSync = () => useContext(Ctx)

function blobsDiffer(a: Config, b: Config): boolean {
  const norm = (c: Config) => JSON.stringify({ p: c.pages, i: c.icons, l: c.layoutSettings })
  return norm(a) !== norm(b)
}

export function ConfigSyncProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [state, setState] = useState<SyncState>({
    ready: false,
    online: typeof navigator !== 'undefined' ? navigator.onLine : true,
    conflict: false,
  })
  const readyRef = useRef(false)

  /** 一次和解:load 镜像 → fetch 服务端 → 决策 → 落盘 + 回填缓存。 */
  async function reconcile(uid: number): Promise<void> {
    let server: Config
    try {
      server = await fetchConfigOnce()
    } catch {
      // 离线/服务端不可达:有本地镜像则直接喂缓存(只读展示),否则等网络
      const local = await loadMirror(uid)
      if (local) {
        qc.setQueryData<Config>(['config'], local.config)
      }
      return
    }
    const local = await loadMirror(uid)
    const action = decideReconciliation(local, server.updatedAt)

    if (action === 'push' && local) {
      // 本地恢复服务端(离线脏 / 服务端丢失):整体 PUT,服务端重排 id 后重拉
      await apiFetch<{ updatedAt?: string }>('/api/config', {
        method: 'PUT',
        body: JSON.stringify(toWireConfig(local.config)),
      })
      const fresh = await fetchConfigOnce()
      qc.setQueryData<Config>(['config'], fresh)
      await saveMirror(uid, { config: fresh, updatedAt: fresh.updatedAt, dirty: false })
      return
    }

    // pull / conflict / none:服务端是赢家(或一致)。覆盖本地前,若内容真变了则留底。
    if (local && (action === 'conflict' || (action === 'pull' && blobsDiffer(local.config, server)))) {
      await saveConflict(uid, local)
      setState((s) => ({ ...s, conflict: true }))
    }
    await saveMirror(uid, { config: server, updatedAt: server.updatedAt, dirty: false })
    qc.setQueryData<Config>(['config'], server)
  }

  // boot:user 变化跑一次和解,完成后 ready
  useEffect(() => {
    if (!user) return
    let cancelled = false
    readyRef.current = false
    setState((s) => ({ ...s, ready: false }))
    void (async () => {
      try {
        await reconcile(user.id)
      } finally {
        if (!cancelled) {
          readyRef.current = true
          setState((s) => ({ ...s, ready: true }))
        }
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  // 在线/离线:恢复在线重跑和解
  useEffect(() => {
    if (!user) return
    const onOnline = () => {
      setState((s) => ({ ...s, online: true }))
      void reconcile(user.id).finally(() => setState((s) => ({ ...s, ready: true })))
    }
    const onOffline = () => setState((s) => ({ ...s, online: false }))
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  // 缓存订阅:仅在网络拉取成功(action.type==='success')时落盘 clean 镜像。
  // 关键:乐观写(setQueryData)派发的是 SetStateAction 而非 success,故不会把"未验证的乐观数据"
  // 当成权威落盘——避免"标签页在写未 settle 时关闭"留下幻影数据造成静默丢失(ADR-0006 Req6)。
  useEffect(() => {
    if (!user) return
    const unsub = qc.getQueryCache().subscribe((event) => {
      if (event.type !== 'updated') return
      if (event.query.queryKey[0] !== 'config') return
      if (event.action.type !== 'success') return
      const data = qc.getQueryData<Config>(['config'])
      if (!data || !readyRef.current) return
      void saveMirror(user.id, { config: data, updatedAt: data.updatedAt ?? null, dirty: false })
    })
    return unsub
  }, [user?.id, qc])

  // 启动若已有 conflict 留底 → 提示
  useEffect(() => {
    if (!user) return
    void loadConflict(user.id).then((c) => {
      if (c) setState((s) => ({ ...s, conflict: true }))
    })
  }, [user?.id])

  if (!state.ready) {
    return (
      <div className="h-screen flex items-center justify-center text-white/70 text-sm">
        同步中…
      </div>
    )
  }

  return (
    <Ctx.Provider value={state}>
      {children}
      {!state.online && (
        <div className="fixed bottom-4 left-4 z-50 glass-panel text-white/85 text-xs px-3 py-1.5 rounded-full shadow">
          离线 · 只读(展示本地镜像,恢复网络后自动同步)
        </div>
      )}
      {state.conflict && user && (
        <ConflictToast uid={user.id} onDismiss={() => setState((s) => ({ ...s, conflict: false }))} />
      )}
    </Ctx.Provider>
  )
}

/** 冲突留底 toast:本地分叉已存 IndexedDB,可导出或忽略。绝不静默丢。 */
function ConflictToast({ uid, onDismiss }: { uid: number; onDismiss: () => void }) {
  const [local, setLocal] = useState<MirrorRecord | null>(null)
  useEffect(() => {
    void loadConflict(uid).then(setLocal)
  }, [uid])
  return (
    <div className="fixed bottom-4 inset-x-0 z-50 flex justify-center px-4 pointer-events-none">
      <div className="glass-panel pointer-events-auto text-white/90 text-sm px-4 py-2.5 rounded-xl shadow-lg flex items-center gap-3 max-w-md">
        <span>检测到冲突,本地版本已保留。</span>
        <button
          type="button"
          className="underline hover:text-white"
          onClick={() => {
            if (local) downloadJson(`chrome-tab-local-${Date.now()}.json`, toBackupPayload(local.config))
          }}
        >
          导出本地
        </button>
        <button
          type="button"
          className="underline hover:text-white"
          onClick={async () => {
            await clearConflict(uid)
            onDismiss()
          }}
        >
          忽略
        </button>
      </div>
    </div>
  )
}
