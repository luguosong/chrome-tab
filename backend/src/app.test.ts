import { describe, expect, it } from 'vitest'
import { createApp } from './app'
import { openDb } from './db'

// 骨架探针契约：业务端点票 04+ 逐票挂载，冻结契约见 .scratch/backend-rewrite/api-contract.md
const app = createApp({ db: openDb(':memory:').db })

describe('GET /healthz', () => {
  it('200 + {status:"ok"}(含 DB 连通探测)', async () => {
    const res = await app.request('/healthz')
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ status: 'ok' })
  })
})
