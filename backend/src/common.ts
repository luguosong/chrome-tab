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

/** 简易 TTL 缓存(自 weather.ts 提为共享):仅存成功结果,过期失效;重启清空可接受(分钟级数据,重拉无感)。 */
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
 * 上游文本抓取(超时防挂起,ADR-0017;status/body 挂错误上供调用方分类)。
 * changelog/videoUpdates/modelTracking 三处同形,自第三处起收归共享。
 */
export async function fetchText(url: string, timeoutMs: number, init?: RequestInit): Promise<string> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) {
    throw Object.assign(new Error(`${init?.method ?? 'GET'} ${url} → HTTP ${res.status}`), {
      status: res.status,
      body: (await res.text()).slice(0, 200),
    })
  }
  return res.text()
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
