import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from './password'

describe('password(bcryptjs)', () => {
  it('roundtrip:cost 10 产出 $2 前缀哈希,可验证正确口令、拒绝错误口令', async () => {
    const hash = await hashPassword('s3cret!')
    expect(hash).toMatch(/^\$2[aby]\$/)
    await expect(verifyPassword('s3cret!', hash)).resolves.toBe(true)
    await expect(verifyPassword('wrong', hash)).resolves.toBe(false)
  })
})
