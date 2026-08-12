import { describe, expect, it } from 'vitest'
import { resolveWrapPage } from './carouselNav'

// 环形翻页取模逻辑(ADR-0008)。纯函数断言,无 DOM。
// 重点覆盖负数取模修正与首尾环形边界,这是 off-by-one 高发区。

describe('resolveWrapPage — 非环形(范围内输入原样返回)', () => {
  it('首页/中间/末页均 isWrap=false', () => {
    expect(resolveWrapPage(0, 3)).toEqual({ pageIndex: 0, isWrap: false })
    expect(resolveWrapPage(1, 3)).toEqual({ pageIndex: 1, isWrap: false })
    expect(resolveWrapPage(2, 3)).toEqual({ pageIndex: 2, isWrap: false })
  })

  it('单页点击唯一页(范围内,非环形)', () => {
    expect(resolveWrapPage(0, 1)).toEqual({ pageIndex: 0, isWrap: false })
  })
})

describe('resolveWrapPage — 环形(越界首尾相接)', () => {
  it('首页往上(i=-1)→末页', () => {
    expect(resolveWrapPage(-1, 3)).toEqual({ pageIndex: 2, isWrap: true })
  })

  it('末页往下(i=count)→首页', () => {
    expect(resolveWrapPage(3, 3)).toEqual({ pageIndex: 0, isWrap: true })
  })

  it('两页:左越界/右越界互为对端', () => {
    expect(resolveWrapPage(-1, 2)).toEqual({ pageIndex: 1, isWrap: true })
    expect(resolveWrapPage(2, 2)).toEqual({ pageIndex: 0, isWrap: true })
  })

  it('单页越界(i=-1)→自身(环形回到唯一页,no-op 由 goTo 落点=当前位置触发)', () => {
    expect(resolveWrapPage(-1, 1)).toEqual({ pageIndex: 0, isWrap: true })
  })
})

describe('resolveWrapPage — 多步越界取模(双取模公式的核心,负数修正)', () => {
  // 单步边界(-1/count)上面已覆盖;这里针对 ((i % count) + count) % count 的多步行为——
  // 朴素写法 `i < 0 ? count - 1 : 0` 会在此处出错,正是抽出纯函数的理由。

  it('负多步 i=-2,count=3 → 末页前一页(=1)', () => {
    expect(resolveWrapPage(-2, 3)).toEqual({ pageIndex: 1, isWrap: true })
  })

  it('正多步 i=count+1 → 第 1 页', () => {
    expect(resolveWrapPage(4, 3)).toEqual({ pageIndex: 1, isWrap: true })
  })

  it('i=-count(整整反向绕一圈)→ 首页', () => {
    expect(resolveWrapPage(-3, 3)).toEqual({ pageIndex: 0, isWrap: true })
  })
})

describe('resolveWrapPage — 空页集', () => {
  it('count=0 返回 null', () => {
    expect(resolveWrapPage(0, 0)).toBeNull()
  })

  it('count<0 返回 null', () => {
    expect(resolveWrapPage(0, -1)).toBeNull()
  })
})
