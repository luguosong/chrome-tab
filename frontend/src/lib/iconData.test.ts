import { describe, expect, it } from 'vitest'
import { navIconSrc } from './iconData'

// navIconSrc:nav 图标实际渲染地址——「图标覆盖」优先,回落「派生 favicon」(CONTEXT.md)。
// (表单值→data 的序列化用例随 buildIconData 退役迁至 components/editorFields.test.ts,
//  预填/序列化/必填语义现居字段臂,见 components/editorFields.tsx。)

describe('navIconSrc(渲染优先级:图标覆盖 > 派生 favicon)', () => {
  it('有覆盖(data.icon)用覆盖', () => {
    expect(navIconSrc({ url: 'https://a.com/x', icon: 'https://cdn.a.com/logo.png' })).toBe(
      'https://cdn.a.com/logo.png',
    )
  })

  it('无覆盖回落派生 favicon(Google s2)', () => {
    expect(navIconSrc({ url: 'https://a.com/x', icon: '' })).toBe(
      'https://www.google.com/s2/favicons?domain=a.com&sz=64',
    )
  })

  it('无 url / data 为空 → 空串(不渲染图形)', () => {
    expect(navIconSrc({ url: '', icon: '' })).toBe('')
    expect(navIconSrc(null)).toBe('')
  })

  it('覆盖优先于非法 url(url 解析失败但覆盖存在仍用覆盖)', () => {
    expect(navIconSrc({ url: 'not a url', icon: 'https://x/y.png' })).toBe('https://x/y.png')
  })
})
