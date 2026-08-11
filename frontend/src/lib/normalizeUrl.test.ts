import { describe, expect, it } from 'vitest'
import { normalizeUrl } from './normalizeUrl'

// issue 09:新增抽屉里链接 url 自动补 https:// 前缀。

describe('normalizeUrl', () => {
  it('空串原样返回空', () => {
    expect(normalizeUrl('')).toBe('')
    expect(normalizeUrl('   ')).toBe('')
  })

  it('裸域名补 https://', () => {
    expect(normalizeUrl('github.com')).toBe('https://github.com')
    expect(normalizeUrl('example.com/path?q=1')).toBe('https://example.com/path?q=1')
  })

  it('已有 http(s):// 前缀原样返回', () => {
    expect(normalizeUrl('https://github.com')).toBe('https://github.com')
    expect(normalizeUrl('http://insecure.example.com')).toBe('http://insecure.example.com')
    expect(normalizeUrl('HTTPS://UPPER.COM')).toBe('HTTPS://UPPER.COM')
  })

  it('去除首尾空白后再判断', () => {
    expect(normalizeUrl('  github.com  ')).toBe('https://github.com')
    expect(normalizeUrl('  https://a.com  ')).toBe('https://a.com')
  })
})
