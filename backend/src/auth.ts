import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import type { Handler, MiddlewareHandler } from 'hono'
import type { Db } from './db'
import { verifyPassword } from './password'

/**
 * auth 契约冻结见 .scratch/backend-rewrite/issues/04 §4 + api-contract.md §1。
 * 会话载体 = SQLite sessions 表(session_id, user_id, expires_at;TTL 30d,多 session 并存,
 * 重启不掉线);过期读路径惰性视同无会话,物理清理走每日 cron(index.ts)。
 * 挂载顺序即拦截面:sessionMiddleware → login/logout(放行,logout 幂等化)→ requireAuth → 其余 /api/**。
 */
export interface AuthEnv {
  Variables: { user?: { id: number; username: string } }
}

const MAX_AGE_S = 30 * 24 * 3600
const nowIso = () => new Date().toISOString()

export function sessionMiddleware(db: Db): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    const sid = getCookie(c, 'JSESSIONID')
    if (sid) {
      const user = await db
        .selectFrom('sessions')
        .innerJoin('users', 'users.id', 'sessions.user_id')
        .select(['users.id as id', 'users.username as username'])
        .where('sessions.session_id', '=', sid)
        // ISO-8601 UTC 文本字典序即时间序(spec:容器保持 UTC)
        .where('sessions.expires_at', '>', nowIso())
        .executeTakeFirst()
      if (user) c.set('user', user)
    }
    await next()
  }
}

/** 契约:filter 层 401 空体(区别于 login 端点的 401 JSON 错误体) */
export function requireAuth(): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    if (!c.get('user')) return c.body(null, 401)
    await next()
  }
}

/** login/logout 两端点,须在 requireAuth 之前挂载(放行面) */
export function publicAuthRoutes(db: Db, cookieSecure: boolean) {
  return (
    new Hono<AuthEnv>()
      .post('/api/login', async (c) => {
        // 缺 body / 非 JSON / 字段缺失或非串都归一为空串 → 400(@NotBlank 语义)
        const body: unknown = await c.req.json().catch(() => null)
        const { username, password } = (body ?? {}) as Record<string, unknown>
        const u = typeof username === 'string' ? username : ''
        const p = typeof password === 'string' ? password : ''
        // message 按 Java 逐字:@NotBlank 无中文 bundle,默认英文按实际失败字段拼接
        const blank = [!u.trim() && 'username', !p.trim() && 'password'].filter(Boolean)
        if (blank.length) {
          return c.json({ status: 400, message: blank.map((f) => `${f}: must not be blank`).join('; ') }, 400)
        }
        const user = await db
          .selectFrom('users')
          .selectAll()
          .where('username', '=', u)
          .executeTakeFirst()
        if (!user || !(await verifyPassword(p, user.password))) {
          return c.json({ status: 401, message: '用户名或密码错误' }, 401)
        }
        const sessionId = randomUUID()
        await db
          .insertInto('sessions')
          .values({
            session_id: sessionId,
            user_id: user.id,
            expires_at: new Date(Date.now() + MAX_AGE_S * 1000).toISOString(),
          })
          .execute()
        setCookie(c, 'JSESSIONID', sessionId, {
          path: '/',
          httpOnly: true,
          sameSite: 'Strict',
          maxAge: MAX_AGE_S,
          secure: cookieSecure,
        })
        return c.json({ id: user.id, username: user.username })
      })
      // 幂等化(修正白名单⑦):无会话/过期会话同样 200 空体
      .post('/api/logout', async (c) => {
        const sid = getCookie(c, 'JSESSIONID')
        if (sid) await db.deleteFrom('sessions').where('session_id', '=', sid).execute()
        return c.body(null, 200)
      })
  )
}

export const meHandler: Handler<AuthEnv> = (c) => {
  const { id, username } = c.get('user')!
  return c.json({ id, username })
}
