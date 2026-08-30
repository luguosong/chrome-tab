import { describe, expect, it } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import {
  decideReconciliation,
  isAuthoritativeCacheUpdate,
  tsValue,
  type CacheUpdateAction,
  type MirrorRecord,
} from './reconcile'
import type { Config } from '../types'
import { CONFIG_KEY } from '../../api/config'
import { DEFAULT_LAYOUT_SETTINGS } from '../layoutSettings'

function cfg(): Config {
  return { pages: [{ id: 1, name: 'P', sortOrder: 0 }], icons: [], layoutSettings: { ...DEFAULT_LAYOUT_SETTINGS }, updatedAt: '2026-08-12T10:00:00' }
}
function mirror(over: Partial<MirrorRecord> = {}): MirrorRecord {
  return { config: cfg(), updatedAt: '2026-08-12T10:00:00', dirty: false, ...over }
}

describe('tsValue', () => {
  it('null/undefined → -∞(最旧)', () => {
    expect(tsValue(null)).toBe(-Infinity)
    expect(tsValue(undefined)).toBe(-Infinity)
    expect(tsValue('')).toBe(-Infinity)
  })
  it('纳秒小数截到秒后仍可解析', () => {
    expect(tsValue('2026-08-12T10:30:00.123456789')).toBe(
      new Date('2026-08-12T10:30:00').getTime(),
    )
  })
  it('更晚的时间戳数值更大(可比)', () => {
    expect(tsValue('2026-08-12T10:30:00')).toBeGreaterThan(tsValue('2026-08-12T10:00:00'))
  })
})

describe('decideReconciliation', () => {
  it('本地无镜像 → pull(浏览器清空/首跑)', () => {
    expect(decideReconciliation(null, '2026-08-12T10:00:00')).toBe('pull')
  })
  it('本地非空 且 服务端无版本(丢失) → push(用本地恢复)', () => {
    expect(decideReconciliation(mirror(), null)).toBe('push')
  })
  it('本地空 且 服务端无版本 → none(都不用动)', () => {
    const empty = mirror({ config: { ...cfg(), pages: [] } })
    expect(decideReconciliation(empty, null)).toBe('none')
  })
  it('本地干净 + 服务端更新 → pull(另一设备改过)', () => {
    expect(decideReconciliation(mirror(), '2026-08-12T11:00:00')).toBe('pull')
  })
  it('本地干净 + 服务端未更新 → none', () => {
    expect(decideReconciliation(mirror(), '2026-08-12T10:00:00')).toBe('none')
  })
  it('本地脏 + 服务端未更新 → push(离线编辑重连)', () => {
    expect(decideReconciliation(mirror({ dirty: true }), '2026-08-12T10:00:00')).toBe('push')
  })
  it('本地脏 + 服务端更新 → conflict(另一端改过,服务端赢、本地留底)', () => {
    expect(decideReconciliation(mirror({ dirty: true }), '2026-08-12T11:00:00')).toBe('conflict')
  })
  it('本地脏 + 服务端无版本 → push(服务端丢失,推本地)', () => {
    expect(decideReconciliation(mirror({ dirty: true }), null)).toBe('push')
  })
})

describe('isAuthoritativeCacheUpdate — 镜像落盘判别(锁 TanStack 行为契约)', () => {
  /** 收集 ['config'] 的缓存事件 action(与 ConfigSyncProvider 订阅同款过滤口径)。 */
  function collectActions(qc: QueryClient): CacheUpdateAction[] {
    const actions: CacheUpdateAction[] = []
    qc.getQueryCache().subscribe((e) => {
      if (e.type === 'updated' && e.query.queryKey[0] === CONFIG_KEY[0]) {
        actions.push(e.action as CacheUpdateAction)
      }
    })
    return actions
  }

  it('契约:setQueryData 派发 type:"success" + manual:true(手动写不是网络拉取)', () => {
    const qc = new QueryClient()
    const actions = collectActions(qc)
    qc.setQueryData<Config>(CONFIG_KEY, cfg())
    expect(actions).toHaveLength(1)
    expect(actions[0].type).toBe('success')
    expect(actions[0].manual).toBe(true)
  })

  it('契约:网络 fetch 成功派发 type:"success" 且无 manual 标记', async () => {
    const qc = new QueryClient()
    const actions = collectActions(qc)
    await qc.fetchQuery({ queryKey: CONFIG_KEY, queryFn: async () => cfg() })
    expect(actions.some((a) => a.type === 'success')).toBe(true)
    expect(actions.every((a) => a.manual !== true)).toBe(true)
  })

  it('契约:cancelQueries 的 revert 走 setState 而非 success(中止不是权威)', async () => {
    const qc = new QueryClient()
    const actions = collectActions(qc)
    const inflight = qc.fetchQuery({
      queryKey: CONFIG_KEY,
      queryFn: () => new Promise<Config>(() => {}),
    })
    await qc.cancelQueries({ queryKey: CONFIG_KEY })
    await inflight.then(
      () => {},
      () => {},
    )
    expect(actions.map((a) => a.type)).toContain('setState')
    expect(actions.every((a) => !isAuthoritativeCacheUpdate(a))).toBe(true) // 中止序列无一被误判权威
  })

  it('判别:乐观写/还原快照(手动)拒,网络拉取收——乐观态不得落盘 clean 镜像', async () => {
    const qc = new QueryClient()
    const actions = collectActions(qc)
    qc.setQueryData<Config>(CONFIG_KEY, cfg()) // 乐观写/还原快照同款手动路径
    await qc.fetchQuery({ queryKey: CONFIG_KEY, queryFn: async () => cfg() }) // 网络权威
    // fetch 前另有 {type:'fetch'} 状态事件(判别同样拒收),只看 success 序列
    const verdicts = actions.filter((a) => a.type === 'success').map(isAuthoritativeCacheUpdate)
    expect(verdicts).toEqual([false, true])
  })
})
