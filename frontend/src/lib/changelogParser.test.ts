import { describe, expect, it } from 'vitest'
import { inline, parseChangelog } from './changelogParser'

const MD = `# Changelog

intro line (ignored)

## 1.2.3

### Highlights
- big feature
- another thing

### Bug fixes
- fixed X

## 1.2.2

- standalone item
`

describe('parseChangelog', () => {
  const v = parseChangelog(MD)

  it('每 ## 一个版本，忽略首个 ## 之前的内容', () => {
    expect(v).toHaveLength(2)
    expect(v[0].title).toBe('1.2.3')
    expect(v[1].title).toBe('1.2.2')
  })

  it('### 分小节，条目归入对应小节', () => {
    expect(v[0].sections).toHaveLength(2)
    expect(v[0].sections[0]).toEqual({ name: 'Highlights', items: ['big feature', 'another thing'] })
    expect(v[0].sections[1]).toEqual({ name: 'Bug fixes', items: ['fixed X'] })
  })

  it('小节外的条目进 top', () => {
    expect(v[1].sections).toEqual([])
    expect(v[1].top).toEqual(['standalone item'])
  })
})

describe('inline', () => {
  it('转义 HTML 后再套代码/加粗/链接', () => {
    expect(inline('use `tool` **b** [a](https://x.com) <b>')).toBe(
      'use <code>tool</code> <strong>b</strong> <a href="https://x.com" target="_blank" rel="noreferrer">a</a> &lt;b&gt;'
    )
  })

  it('引号属性注入被中和：URL 里的 " 转义为 &quot;，逃不出 href 属性', () => {
    const out = inline('[x](https://e.com" onmouseover="bad)')
    expect(out).toBe(
      '<a href="https://e.com&quot; onmouseover=&quot;bad" target="_blank" rel="noreferrer">x</a>'
    )
    // 不允许出现被浏览器当作独立属性的裸 onmouseover
    expect(out).not.toContain('" onmouseover="bad"')
  })

  it('javascript: URL 不被链接化（强制 https?: 前缀）', () => {
    expect(inline('[x](javascript:alert(1))')).toBe('[x](javascript:alert(1))')
  })
})
