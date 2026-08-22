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

/** config_version bump(ADR-0006):upsert 当前用户版本为 now。必须在写事务末尾调用,与配置写原子。 */
export async function touchVersion(db: Db, userId: number): Promise<void> {
  const now = new Date().toISOString()
  await db
    .insertInto('config_version')
    .values({ user_id: userId, updated_at: now })
    .onConflict((oc) => oc.column('user_id').doUpdateSet({ updated_at: now }))
    .execute()
}
