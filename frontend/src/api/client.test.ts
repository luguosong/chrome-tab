import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, apiFetch } from './client'

/** 构造一个最小 Response 形状(fetch Response 在 Node 20+ 可直接用) */
const res = (status: number, body: string | null, contentType?: string) =>
  new Response(body ?? null, {
    status,
    headers: contentType ? { 'content-type': contentType } : {},
  })

afterEach(() => vi.unstubAllGlobals())

describe('apiFetch 响应体解析', () => {
  it('2xx JSON 照常解析', async () => {
    vi.stubGlobal('fetch', async () => res(200, '{"id":1,"username":"admin"}', 'application/json'))
    await expect(apiFetch('/api/login', { method: 'POST' })).resolves.toEqual({
      id: 1,
      username: 'admin',
    })
  })

  // 回归:logout 后端契约是 200 空体(auth.ts 幂等化),曾因 r.json() 抛
  // 「Unexpected end of JSON input」阻断 setUser(null),登出不跳转。
  it('204 与空体 2xx 一律返回 undefined,不调 json()', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => res(200, null)),
    )
    await expect(apiFetch<void>('/api/logout', { method: 'POST' })).resolves.toBeUndefined()
  })

  it('非 2xx 抛 ApiError 并取错误体 message', async () => {
    vi.stubGlobal('fetch', async () => res(401, '{"message":"未登录"}', 'application/json'))
    const err: ApiError = await apiFetch('/api/me').then(
      () => {
        throw new Error('应当抛错')
      },
      (e) => e,
    )
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(401)
    expect(err.message).toBe('未登录')
  })
})
