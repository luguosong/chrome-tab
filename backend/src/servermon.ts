import { schedule } from 'node-cron'
import { Hono } from 'hono'
import type { ServerMonEntry, ServerMonHistoryPoint, ServerMonSnapshot } from 'chrome-tab-shared'
import type { AuthEnv } from './auth'
import type { Db } from './db'
import { asRec, BadRequest, str } from './common'

/**
 * 「服务器状态」(CONTEXT.md「服务器状态」):thinkpad/aliyun 各跑一个 servermon
 * exporter(thinkpad-ubuntu 仓库 scripts/servermon,Python stdlib ~10MB)。本服务:
 * - 快照 GET /api/servers:按需并抓两台 + 60s TTL;抓不到 = offline——可达性由
 *   取数成败兼任,无独立 ping 组件;失败降级宁旧勿空(保留最后成功快照,前端示陈旧)。
 * - 采样 cron 10min(3-53 错开整点)落库 server_samples 数值曲线,仅落 online 机器
 *   (宁缺勿错);services/containers 不落库,展示实时即可。
 * exporter 经 env 注入 URL(含 token):SERVERMON_THINKPAD_URL / SERVERMON_ALIYUN_URL;
 * 机器清单空(本地 dev)时快照返回空数组,不炸。
 */

/** 快照 TTL;与前端 1min 刷新节奏同量级。 */
const SNAPSHOT_TTL_MS = 60_000
const FETCH_TIMEOUT_MS = 5_000

export interface ServerMonMachine {
  machine: string
  url: string
}

/** deps 注入 seam(测试塞假 fetch,同 TrendingDeps 范式)。 */
export interface ServerMonDeps {
  fetchJson: (url: string, timeoutMs: number) => Promise<unknown>
}

export const prodServerMonDeps = (): ServerMonDeps => ({
  fetchJson: async (url, timeoutMs) => {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) throw new Error(`servermon → HTTP ${res.status}`)
    return res.json()
  },
})

/** exporter JSON(snake_case)→ 契约 DTO(camelCase);残体收敛不抛(防御式,同 weather 口径)。 */
export function parseSnapshot(raw: unknown): ServerMonSnapshot {
  const m = asRec(raw)
  const numOr = (k: string): number => {
    const n = typeof m?.[k] === 'number' ? (m[k] as number) : Number(str(m, k) ?? Number.NaN)
    return Number.isFinite(n) ? n : 0
  }
  const services: ServerMonSnapshot['services'] = {}
  for (const [k, v] of Object.entries(asRec(m?.services) ?? {})) {
    const sv = asRec(v)
    const result = str(sv, 'result')
    services[k] = { state: str(sv, 'state') ?? 'unknown', ...(result !== null ? { result } : {}) }
  }
  const containers: Record<string, string> = {}
  for (const [k, v] of Object.entries(asRec(m?.containers) ?? {})) containers[k] = String(v)
  return {
    host: str(m, 'host') ?? '',
    ts: str(m, 'ts') ?? '',
    cpuPct: numOr('cpu_pct'),
    load1: numOr('load1'),
    memTotal: numOr('mem_total'),
    memAvail: numOr('mem_avail'),
    diskTotal: numOr('disk_total'),
    diskFree: numOr('disk_free'),
    uptimeS: numOr('uptime_s'),
    failedUnits: numOr('failed_units'),
    services,
    containers,
  }
}

export class ServerMonService {
  /** 最后成功快照(降级数据源);ok = 最近一轮并抓的成功集合(在线判定)。 */
  private readonly last = new Map<string, { snapshot: ServerMonSnapshot; fetchedAt: number }>()
  private ok = new Set<string>()
  private cacheUntil = 0

  constructor(
    private readonly db: Db,
    private readonly deps: ServerMonDeps,
    private readonly machines: ServerMonMachine[],
    private readonly ttlMs = SNAPSHOT_TTL_MS,
  ) {}

  /** 快照:TTL 未过期直接回;过期并抓全机器,单机失败不拖垮其余。 */
  async snapshot(): Promise<ServerMonEntry[]> {
    if (Date.now() >= this.cacheUntil) {
      this.cacheUntil = Date.now() + this.ttlMs
      const ok = new Set<string>()
      await Promise.all(
        this.machines.map((m) =>
          this.fetchOne(m)
            .then(() => ok.add(m.machine))
            .catch((e) => console.warn(`servermon ${m.machine} 取数失败:`, e)),
        ),
      )
      this.ok = ok
    }
    return this.machines.map((m) => {
      const hit = this.last.get(m.machine)
      return {
        machine: m.machine,
        status: this.ok.has(m.machine) ? ('online' as const) : ('offline' as const),
        snapshot: hit?.snapshot ?? null,
        fetchedAt: hit ? new Date(hit.fetchedAt).toISOString() : null,
      }
    })
  }

  /** cron 采样:复用快照(TTL 10min 早过期,每轮必真抓),online 机器落曲线。 */
  async sampleAll(): Promise<void> {
    for (const entry of await this.snapshot()) {
      if (entry.status !== 'online' || !entry.snapshot) continue
      const s = entry.snapshot
      await this.db
        .insertInto('server_samples')
        .values({
          machine: entry.machine,
          ts: new Date().toISOString(),
          cpu_pct: s.cpuPct,
          load1: s.load1,
          mem_total: s.memTotal,
          mem_avail: s.memAvail,
          disk_total: s.diskTotal,
          disk_free: s.diskFree,
          uptime_s: s.uptimeS,
        })
        .execute()
    }
  }

  /** 历史曲线(machine 过滤 + hours 时间窗,ts 升序)。 */
  async history(machine: string, hours: number): Promise<ServerMonHistoryPoint[]> {
    const cutoff = new Date(Date.now() - hours * 3_600_000).toISOString()
    const rows = await this.db
      .selectFrom('server_samples')
      .select(['ts', 'cpu_pct', 'load1', 'mem_avail', 'disk_free'])
      .where('machine', '=', machine)
      .where('ts', '>=', cutoff)
      .orderBy('ts', 'asc')
      .execute()
    return rows.map((r) => ({
      ts: r.ts,
      cpuPct: r.cpu_pct,
      load1: r.load1,
      memAvail: r.mem_avail,
      diskFree: r.disk_free,
    }))
  }

  private async fetchOne(m: ServerMonMachine): Promise<void> {
    const snapshot = parseSnapshot(await this.deps.fetchJson(m.url, FETCH_TIMEOUT_MS))
    this.last.set(m.machine, { snapshot, fetchedAt: Date.now() })
  }
}

// ---- HTTP 路由 ----

export function servermonRoutes(service: ServerMonService): Hono<AuthEnv> {
  return new Hono<AuthEnv>()
    .get('/api/servers', async (c) => c.json(await service.snapshot()))
    .get('/api/servers/history', async (c) => {
      const machine = c.req.query('machine')?.trim()
      if (!machine) throw new BadRequest('machine: 缺少机器名参数')
      const hours = Math.min(Math.max(Number(c.req.query('hours') ?? 24) || 24, 1), 720)
      return c.json({ machine, points: await service.history(machine, hours) })
    })
}

// ---- 调度 ----

/** 10min 采样一轮(3-53/10 错开整点与既有调度器);启动即采样,重启不空窗。 */
export function startServerMonScheduler(service: ServerMonService): void {
  void service.sampleAll().catch((e) => console.error('servermon 启动采样失败:', e))
  schedule('3-53/10 * * * *', () =>
    service.sampleAll().catch((e) => console.error('servermon 采样失败:', e)),
  )
}
