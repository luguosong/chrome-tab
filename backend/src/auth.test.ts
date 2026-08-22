import { beforeAll, describe, expect, it } from 'vitest'
import { createApp } from './app'
import { openDb } from './db'
import { bootstrap } from './seed'

// auth 契约冻结见 .scratch/backend-rewrite/issues/04 §4 + api-contract.md §1。
// fixture = 内存 SQLite + seed 基线(spec Testing Decisions);每用例独立 login 取独立 sid,互不串行污染。

const { db } = openDb(':memory:')
const app = createApp({ db })

const post = (path: string, body?: unknown) =>
  app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

/** login 一次,返回首个 cookie 键值对(如 `JSESSIONID=<uuid>`) */
async function login(username = 'admin', password = 'admin-pw') {
  const res = await post('/api/login', { username, password })
  const kv = res.headers.getSetCookie()[0]!.split(';')[0]!
  return { res, kv }
}

/** 把 kv 对应的 session 行改成远古过期(测惰性失效) */
async function expireSession(kv: string) {
  const sid = kv.split('=')[1]!
  await db
    .updateTable('sessions')
    .set({ expires_at: '2000-01-01T00:00:00.000Z' })
    .where('session_id', '=', sid)
    .execute()
}

beforeAll(async () => {
  await bootstrap(db, { username: 'admin', password: 'admin-pw' })
})

describe('POST /api/login', () => {
  it('200 {id, username} + cookie 属性逐项照契约(JSESSIONID/HttpOnly/SameSite=Strict/Max-Age 30d/Path=/,默认非 Secure)', async () => {
    const { res, kv } = await login()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ id: 1, username: 'admin' })
    expect(kv).toMatch(/^JSESSIONID=[\w-]+$/)
    const cookie = res.headers.getSetCookie()[0]!
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')
    expect(cookie).toContain('Max-Age=2592000')
    expect(cookie).toContain('Path=/')
    expect(cookie).not.toContain('Secure')
    // session 落库,TTL 30d
    const rows = await db.selectFrom('sessions').selectAll().execute()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.user_id).toBe(1)
    expect(new Date(rows[0]!.expires_at).getTime()).toBeGreaterThan(Date.now() + 29 * 24 * 3600 * 1000)
  })

  it('prod(secure)下 Set-Cookie 带 Secure', async () => {
    const secureApp = createApp({ db, cookieSecure: true })
    const res = await secureApp.request('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin-pw' }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.getSetCookie()[0]!).toContain('Secure')
  })

  it('错密码 401 {status:401, message:"用户名或密码错误"};未知用户同文案(不泄露用户存在性)', async () => {
    for (const body of [
      { username: 'admin', password: 'wrong' },
      { username: 'nobody', password: 'whatever' },
    ]) {
      const res = await post('/api/login', body)
      expect(res.status).toBe(401)
      await expect(res.json()).resolves.toEqual({ status: 401, message: '用户名或密码错误' })
    }
  })

  it('username/password 空白、缺失、缺 body、非 JSON → 400 {status, message},按实际失败字段拼接', async () => {
    for (const body of [
      { username: '  ', password: 'x' },
      { username: 'admin', password: '' },
      { username: 'admin' },
      {},
    ]) {
      const res = await post('/api/login', body)
      expect(res.status).toBe(400)
      const json = (await res.json()) as { status: number; message: string }
      expect(json.status).toBe(400)
      expect(typeof json.message).toBe('string')
    }
    // 单字段空白只报该字段(照 Java @NotBlank 逐字段拼接,默认英文文案)
    const one = await post('/api/login', { username: 'admin', password: '' })
    await expect(one.json()).resolves.toEqual({ status: 400, message: 'password: must not be blank' })
    const both = await post('/api/login', {})
    await expect(both.json()).resolves.toEqual({
      status: 400,
      message: 'username: must not be blank; password: must not be blank',
    })
    const noBody = await app.request('/api/login', { method: 'POST' })
    expect(noBody.status).toBe(400)
    const badJson = await app.request('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    })
    expect(badJson.status).toBe(400)
  })

  it('Java 侧产出的 bcrypt $2a$ 哈希原样可验(零重置)', async () => {
    // fixture 哈希由 python bcrypt(与 Java BCryptPasswordEncoder 同标准)生成,模拟线上迁移来的 users 行
    const legacy = openDb(':memory:').db
    await legacy
      .insertInto('users')
      .values({
        username: 'admin',
        password: '$2a$10$RAxOAfzYIqvcVD8JKPGgg.ubiZZSmtaCLYlCistB9SSxE8qgeofsy',
        created_at: new Date().toISOString(),
      })
      .execute()
    const legacyApp = createApp({ db: legacy })
    const res = await legacyApp.request('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'correct horse battery staple' }),
    })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ id: 1, username: 'admin' })
  })
})

describe('GET /api/me', () => {
  it('带有效 cookie 200 {id, username}', async () => {
    const { kv } = await login()
    const res = await app.request('/api/me', { headers: { cookie: kv } })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ id: 1, username: 'admin' })
  })

  it('无 cookie 401 空体;任意其他 /api/** 未认证同样 401 空体', async () => {
    for (const req of [
      app.request('/api/me'),
      app.request('/api/config'),
      app.request('/api/anything', { method: 'PUT' }),
    ]) {
      const res = await req
      expect(res.status).toBe(401)
      expect(await res.text()).toBe('')
    }
  })

  it('过期 session 视同未认证(惰性失效)', async () => {
    const { kv } = await login()
    await expireSession(kv)
    const res = await app.request('/api/me', { headers: { cookie: kv } })
    expect(res.status).toBe(401)
  })

  it('重启(新 app 实例、同一 db)后旧 cookie 仍有效——会话在 SQLite 不在内存', async () => {
    const { kv } = await login()
    const restarted = createApp({ db })
    const res = await restarted.request('/api/me', { headers: { cookie: kv } })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ id: 1, username: 'admin' })
  })
})

describe('POST /api/logout(放行端点,幂等化=修正白名单⑦)', () => {
  it('positive:有效会话 logout 200 空体,session 行删除,后续请求 401', async () => {
    const { kv } = await login()
    const sid = kv.split('=')[1]!
    const res = await app.request('/api/logout', { method: 'POST', headers: { cookie: kv } })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('')
    expect(await db.selectFrom('sessions').where('session_id', '=', sid).selectAll().execute()).toHaveLength(0)
    expect((await app.request('/api/me', { headers: { cookie: kv } })).status).toBe(401)
  })

  it('negative:无会话 / 过期会话下 logout 仍 200 而非 401', async () => {
    const noCookie = await app.request('/api/logout', { method: 'POST' })
    expect(noCookie.status).toBe(200)

    const { kv } = await login()
    await expireSession(kv)
    const expired = await app.request('/api/logout', { method: 'POST', headers: { cookie: kv } })
    expect(expired.status).toBe(200)
  })
})

describe('拦截面横切', () => {
  it('多 session 并存:两次 login 各自有效', async () => {
    const a = await login()
    const b = await login()
    expect((await app.request('/api/me', { headers: { cookie: a.kv } })).status).toBe(200)
    expect((await app.request('/api/me', { headers: { cookie: b.kv } })).status).toBe(200)
    // 各自独立
    await app.request('/api/logout', { method: 'POST', headers: { cookie: a.kv } })
    expect((await app.request('/api/me', { headers: { cookie: a.kv } })).status).toBe(401)
    expect((await app.request('/api/me', { headers: { cookie: b.kv } })).status).toBe(200)
  })

  it('非 /api 路径放行(静态资源语义,/healthz 为例)', async () => {
    expect((await app.request('/healthz')).status).toBe(200)
  })
})
