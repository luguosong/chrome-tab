import type { Context } from 'hono'
import type { Db } from './db'
import type { AuthEnv } from './auth'

/**
 * 业务冲突(容量/单例/孤儿引用/非空页等),对应 Java OperationConflictException:
 * 携带 status(400/404/409),app.onError 统一转 {status, message} 响应体。
 */
export class ConflictError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

/** 校验失败 → 400(等价 Java @Valid → MethodArgumentNotValid),消息形状「字段: 消息」。 */
export class BadRequest extends ConflictError {
  constructor(message: string) {
    super(400, message)
  }
}

/** 路径参数转整数;非法(Java 侧 type mismatch 同为 4xx 族)视同不存在 → 404。 */
export function numericParam(c: Context<AuthEnv>, key: string): number {
  const v = Number(c.req.param(key))
  if (!Number.isInteger(v)) throw new ConflictError(404, '资源不存在')
  return v
}

// ── 请求体校验小件(ADR-0048)──────────────────────────────────────────────────

/** 用户起名的统一上限(页面名/视频分类名,Java @Size(max=64) 对齐;三域规则独立、恰同值)。 */
export const NAME_MAX = 64

/** 读请求体;非 JSON/空体收敛 null(不抛)。全 backend 唯一的 `c.req.json()` 持有点(grep 契约断言把关)。 */
export async function jsonBody(c: { req: { json(): Promise<unknown> } }): Promise<unknown> {
  return c.req.json().catch(() => null)
}

/** 嵌套定位拼接:`icons[0].type` 形 400 消息的字段路径(前缀惯例全仓单点)。 */
export const field = (key: string, prefix?: string) => (prefix ? `${prefix}.${key}` : key)
const rec = (b: unknown): Record<string, unknown> => (b ?? {}) as Record<string, unknown>

interface IntOpts {
  /** 数组项等嵌套定位(config 全量替换 blob 的 `icons[0].id`)。 */
  prefix?: string
  /** 闭区间范围;两端必同传——半开会让消息渲染出 undefined,类型上直接封死。 */
  range?: { min: number; max: number }
  /** optInt 的缺省值(缺字段/null 都落此,对齐 Java int 原始类型的 Jackson 默认)。 */
  def?: number
}

/** 必填名字(对齐 @NotBlank @Size(max=NAME_MAX)),trim 后返回、服务端 trim 落库。 */
export function reqName(b: unknown, key = 'name', prefix?: string): string {
  const v = rec(b)[key]
  if (typeof v !== 'string' || !v.trim()) throw new BadRequest(`${field(key, prefix)}: must not be blank`)
  if (v.length > NAME_MAX) throw new BadRequest(`${field(key, prefix)}: size must be between 0 and ${NAME_MAX}`)
  return v.trim()
}

function assertRange(v: number, key: string, opts?: IntOpts): number {
  const r = opts?.range
  if (r && (v < r.min || v > r.max)) {
    throw new BadRequest(`${field(key, opts?.prefix)}: 必须在 ${r.min}~${r.max} 之间`)
  }
  return v
}

/** 必填整数;非整数/缺失 400(消息对齐 Java「must not be null」)。 */
export function reqInt(b: unknown, key: string, opts?: IntOpts): number {
  const v = rec(b)[key]
  if (typeof v !== 'number' || !Number.isInteger(v)) throw new BadRequest(`${field(key, opts?.prefix)}: must not be null`)
  return assertRange(v, key, opts)
}

/** 可缺省整数:缺字段/null 落 def(默认 0);非法 400「必须是整数」。 */
export function optInt(b: unknown, key: string, opts?: IntOpts): number {
  const v = rec(b)[key]
  if (v === undefined || v === null) return opts?.def ?? 0
  if (typeof v !== 'number' || !Number.isInteger(v)) throw new BadRequest(`${field(key, opts?.prefix)}: 必须是整数`)
  return assertRange(v, key, opts)
}

/** 可空整数:缺字段/null → null(「移动图标」的 parentId 形态);非法 400。 */
export function optNullableInt(b: unknown, key: string, prefix?: string): number | null {
  const v = rec(b)[key]
  if (v === undefined || v === null) return null
  if (typeof v !== 'number' || !Number.isInteger(v)) throw new BadRequest(`${field(key, prefix)}: 必须是整数`)
  return v
}

/** 简易 TTL 缓存(自 weather.ts 提为共享):仅存成功结果,过期失效;重启清空可接受(分钟级数据,重拉无感)。
 *  无降级语义——要「失败宁旧勿空」用 cachedOrNull(ADR-0042),两者刻意共存:
 *  weather 段级隐藏(air=null 即「省略该段」)与 wbi 日更密钥等场景,回落旧值反而有害。 */
export class TtlCache<V> {
  private store = new Map<string, { value: V; expiresAt: number }>()

  get(key: string): V | undefined {
    const e = this.store.get(key)
    return e && e.expiresAt > Date.now() ? e.value : undefined
  }

  put(key: string, value: V, ttlMs: number) {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs })
  }
}

/** cachedOrNull 的句柄(ADR-0042):读 + 写后失效 + 失败因查询。 */
export interface CachedSource<K, V> {
  get(key: K): Promise<V | null>
  /** 写操作后强制下读重拉(如待办速记);只清 TTL 缓存——lastGood 是宁旧勿空的底,不清。 */
  invalidate(key: K): void
  /** TTL 未过期的新鲜缓存(不触发取数、不含 lastGood 回落)——「手动补一轮」类
   *  调用方区分「命中」与「新抓/回落」用(引用与 get 命中路径一致)。 */
  peek(key: K): V | undefined
  /** 最近一次取数失败的原因(get 返回 null / 回落时的原始错误;成功即清)——
   *  域选「从未成功上抛」时透传原始因(如趋势榜 500 带「风控」而非泛化文案)。 */
  lastError(key: K): unknown
}

/**
 * 「TTL 缓存 + 宁旧勿空」取数原语(ADR-0042;原 aihot/dida/trending 三份手写变体收拢):
 * 读侧三不变量单点——TTL 内回缓存不发上游;上游失败回落 lastGood(键级、永不过期,
 * 含过期缓存);从未成功回 null(域决定 200 容忍或上抛)。失败不续 TTL,下次调用
 * 即重试。键粒度由域选:单值源传常量键,组合源传序列化键(如趋势榜 `since|lang|spoken`)。
 * 不收的两族:TtlCache 纯缓存(回旧值有害场景,见其注释);servermon 式「失败续
 * TTL 防密集重试 + 批抓聚合 + 单项成败标 online/offline」(语义分叉,ADR-0039 先例)。
 * 「新抓成功」的域钩子(如趋势榜后台补译)写在 fetch 回调内——原语不设 onSuccess
 * 钩子(曾有,因「手动补一轮」调用方与钩子双发 fire-and-forget 而撤,ADR-0042 修订)。
 */
export function cachedOrNull<K, V>(opts: {
  ttlMs: number
  fetch: (key: K) => Promise<V>
  /** 失败运维日志前缀(域名,如「AIHOT 取数失败(/hot-topics)」);省缺不打——
   *  失败已由调用链自记(路由 500 日志/调度 catch)的域用,防双重噪音。 */
  warnLabel?: (key: K) => string
}): CachedSource<K, V> {
  const cache = new Map<K, { at: number; value: V }>()
  const lastGood = new Map<K, V>()
  const lastErr = new Map<K, unknown>()
  return {
    async get(key) {
      const hit = cache.get(key)
      if (hit && Date.now() - hit.at < opts.ttlMs) return hit.value
      try {
        const value = await opts.fetch(key)
        cache.set(key, { at: Date.now(), value })
        lastGood.set(key, value)
        lastErr.delete(key)
        return value
      } catch (e) {
        if (opts.warnLabel) console.warn(`${opts.warnLabel(key)}: ${e}`)
        lastErr.set(key, e)
        return lastGood.get(key) ?? null
      }
    },
    invalidate(key) {
      cache.delete(key)
    },
    peek(key) {
      const hit = cache.get(key)
      return hit && Date.now() - hit.at < opts.ttlMs ? hit.value : undefined
    },
    lastError(key) {
      return lastErr.get(key)
    },
  }
}

// ── wire DTO 防御式读取(weather/aihot/dida 三处同形,第三份触发提取)────────────

export type Rec = Record<string, unknown> | undefined

/** 非法输入(非对象/数组/null)收敛为 undefined,供链式取字段。 */
export const asRec = (v: unknown): Rec =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Rec) : undefined

/** 字段读为 string;缺失/null → null(其余类型 String() 收敛)。 */
export const str = (m: Rec, k: string): string | null => {
  const v = m?.[k]
  return v === undefined || v === null ? null : String(v)
}

/**
 * 上游抓取原语族:超时防挂起(ADR-0017)+ 非 2xx 抛带 status/body 的错(供调用方
 * 分类),此两不变量全 backend 单点。changelog/videoUpdates/modelTracking 三处同形
 * 自第三处收归;2026-08-30 weather/dida/aihot/servermon 的裸 fetch(无超时,weather
 * 有线上事故前科)收编(ADR-0045)。不收:ai/agent——LLM 长读超时自成一族,且已有
 * AgentDeps 注入 seam。统一 Chrome UA 与默认超时(news 源 2026-08-26 起,「GitHub
 * 趋势」剥离成第二消费者后收归)。
 */
export const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

export const chromeHeaders = (extra: Record<string, string> = {}): RequestInit => ({
  headers: { 'user-agent': CHROME_UA, ...extra },
})

/** 匿名抓取默认超时(newnow myFetch 同款)。 */
export const FETCH_TIMEOUT = 10_000

/** Response 底形态:要看响应头/流式消费的调用方用(dida 判 content-type)。 */
export async function fetchRes(url: string | URL, timeoutMs: number, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) {
    throw Object.assign(new Error(`${init?.method ?? 'GET'} ${url} → HTTP ${res.status}`), {
      status: res.status,
      body: (await res.text()).slice(0, 200),
    })
  }
  return res
}

export async function fetchText(url: string | URL, timeoutMs: number, init?: RequestInit): Promise<string> {
  return (await fetchRes(url, timeoutMs, init)).text()
}

export async function fetchJson(url: string | URL, timeoutMs: number, init?: RequestInit): Promise<unknown> {
  return (await fetchRes(url, timeoutMs, init)).json()
}

/** 二进制形态(新闻·联合早报 gb2312 页面,ADR-0027)。 */
export async function fetchBuffer(url: string | URL, timeoutMs: number, init?: RequestInit): Promise<ArrayBuffer> {
  return (await fetchRes(url, timeoutMs, init)).arrayBuffer()
}

/** config_version bump(ADR-0006):upsert 当前用户版本为 now。必须在写事务末尾调用,与配置写原子。 */
export async function touchVersion(db: Db, userId: number): Promise<void> {
  const now = new Date().toISOString()
  await db
    .insertInto('config_version')
    .values({ user_id: userId, updated_at: now })
    .onConflict((oc) => oc.column('user_id').doUpdateSet({ updated_at: now }))
    .execute()
}
