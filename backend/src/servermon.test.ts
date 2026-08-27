import { describe, expect, it } from 'vitest'
import type { ServerMonSnapshot } from 'chrome-tab-shared'
import { openDb } from './db'
import { ServerMonService, parseSnapshot, type ServerMonDeps } from './servermon'
import { setupApp } from './testUtils'

/** exporter 真实形状 fixture(snake_case,scripts/servermon 输出)。 */
const WIRE = {
  host: 'thinkpad',
  ts: '2026-08-27T12:00:00Z',
  cpu_pct: 12.3,
  load1: 0.42,
  mem_total: 31957952 * 1024,
  mem_avail: 29351936 * 1024,
  disk_total: 467938373632,
  disk_free: 425000000000,
  uptime_s: 500000,
  failed_units: 0,
  services: {
    'frpc.service': { state: 'active' },
    'gitbackup-mirror.timer': { state: 'active', result: 'success' },
  },
  containers: { backrest: 'running' },
}

/** 计数 fetch 桩:按 url 前缀路由,可切换在线/离线。 */
function stubDeps(online: () => boolean, body: unknown = WIRE): ServerMonDeps & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    fetchJson: async (url: string) => {
      calls.push(url)
      if (!online()) throw new Error('connect refused')
      return body
    },
  }
}

const MACHINES = [{ machine: 'thinkpad', url: 'http://tp/status?token=x' }]

describe('parseSnapshot(exporter JSON → 契约 DTO)', () => {
  it('snake_case 字段映射为 camelCase,嵌套原样透传', () => {
    const s = parseSnapshot(WIRE)
    expect(s).toEqual({
      host: 'thinkpad',
      ts: '2026-08-27T12:00:00Z',
      cpuPct: 12.3,
      load1: 0.42,
      memTotal: 31957952 * 1024,
      memAvail: 29351936 * 1024,
      diskTotal: 467938373632,
      diskFree: 425000000000,
      uptimeS: 500000,
      failedUnits: 0,
      services: WIRE.services,
      containers: WIRE.containers,
    } satisfies ServerMonSnapshot)
  })

  it('缺字段的残体收敛为 null(防御式,不抛)', () => {
    const s = parseSnapshot({ host: 'x' })
    expect(s.cpuPct).toBe(0)
    expect(s.services).toEqual({})
  })
})

describe('ServerMonService 快照', () => {
  it('在线:online + 快照透传;TTL 内二次读不重抓', async () => {
    const { db } = openDb(':memory:')
    const deps = stubDeps(() => true)
    const svc = new ServerMonService(db, deps, MACHINES)
    const first = await svc.snapshot()
    expect(first[0]).toMatchObject({ machine: 'thinkpad', status: 'online' })
    expect(first[0].snapshot!.host).toBe('thinkpad')
    await svc.snapshot()
    expect(deps.calls.length).toBe(1)
  })

  it('从未成功 + 失败:offline + null;曾有成功 + 失败:offline 但保留旧快照(宁旧勿空)', async () => {
    const { db } = openDb(':memory:')
    let online = true
    const deps = stubDeps(() => online)
    const svc = new ServerMonService(db, deps, MACHINES, 0) // TTL=0 强制每轮真抓
    await svc.snapshot()
    online = false
    const degraded = await svc.snapshot()
    expect(degraded[0].status).toBe('offline')
    expect(degraded[0].snapshot!.host).toBe('thinkpad') // 旧数据还在
    expect(degraded[0].fetchedAt).not.toBeNull()
  })

  it('机器清单为空:返回空数组(dev 无监控机不炸)', async () => {
    const { db } = openDb(':memory:')
    const svc = new ServerMonService(db, stubDeps(() => true), [])
    expect(await svc.snapshot()).toEqual([])
  })
})

describe('采样落库与 history', () => {
  it('sampleAll 写 online 机器曲线,history 按机器/时间窗查回;offline 不写', async () => {
    const { db } = openDb(':memory:')
    let online = true
    const svc = new ServerMonService(
      db,
      stubDeps(() => online),
      MACHINES,
      0,
    )
    await svc.sampleAll()
    online = false
    await svc.sampleAll()
    const points = await svc.history('thinkpad', 24)
    expect(points.length).toBe(1) // 第二轮 offline 未落
    expect(points[0]).toMatchObject({ cpuPct: 12.3, load1: 0.42 })
  })
})

describe('路由(经 createApp,错误统一映射 {status,message})', () => {
  it('GET /api/servers 与 /api/servers/history 走 service(需登录)', async () => {
    const svc = new ServerMonService(openDb(':memory:').db, stubDeps(() => true), MACHINES)
    const { login, req } = await setupApp(undefined, undefined, svc)
    const cookie = await login()
    const res = await req('GET', '/api/servers', { cookie })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { machine: string; status: string }[]
    expect(body[0]).toMatchObject({ machine: 'thinkpad', status: 'online' })
    const hist = await req('GET', '/api/servers/history?machine=thinkpad&hours=24', { cookie })
    expect(hist.status).toBe(200)
  })

  it('history 缺 machine 参数:400;未登录:401', async () => {
    const svc = new ServerMonService(openDb(':memory:').db, stubDeps(() => true), MACHINES)
    const { login, req } = await setupApp(undefined, undefined, svc)
    const cookie = await login()
    const res = await req('GET', '/api/servers/history', { cookie })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ status: 400 })
    expect((await req('GET', '/api/servers')).status).toBe(401)
  })
})
