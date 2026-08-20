import { describe, expect, it } from 'vitest'
import { resolveWrapPage, wrapSlidePlan } from './carouselNav'

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

// wrapSlidePlan — 环形连续滑动的物理计划(修订 ADR-0008:相邻环形从 instant cut 改为
// 克隆页单步滑动)。slide 索引空间:0=左克隆位,1..count=真页,count+1=右克隆位。
// 调用方(Carousel)把 slideTo/settleTo 乘页宽得 scrollLeft。
describe('wrapSlidePlan — 相邻环形(单步,可连续滑动)', () => {
  it('末页 +1 → 克隆首页滑入右克隆位,落定复位到真首页位', () => {
    expect(wrapSlidePlan(0, 2, 3)).toEqual({ cloneFrom: 0, slideTo: 4, settleTo: 1 })
  })

  it('首页 -1 → 克隆末页滑入左克隆位,落定复位到真末页位', () => {
    expect(wrapSlidePlan(2, 0, 3)).toEqual({ cloneFrom: 2, slideTo: 0, settleTo: 3 })
  })

  it('两页:两个方向都是相邻环形,互为镜像', () => {
    expect(wrapSlidePlan(0, 1, 2)).toEqual({ cloneFrom: 0, slideTo: 3, settleTo: 1 })
    expect(wrapSlidePlan(1, 0, 2)).toEqual({ cloneFrom: 1, slideTo: 0, settleTo: 2 })
  })
})

describe('wrapSlidePlan — 不可滑动(返回 null,调用方回落 instant cut)', () => {
  it('多步越界(如 i=count+1 → 页 1):物理跨度 > 1 页,扫过中间页观感错乱', () => {
    expect(wrapSlidePlan(1, 2, 3)).toBeNull() // 末页 +2 绕到页 1
  })

  it('多步反向(i=-2 → 倒数第二页)', () => {
    expect(wrapSlidePlan(1, 0, 3)).toBeNull()
  })

  it('单页:环形解析回自身,无需克隆(调用方 target===scrollLeft 拦截为 no-op)', () => {
    expect(wrapSlidePlan(0, 0, 1)).toBeNull()
  })

  it('非相邻环形(防御:正常导航路径到不了,但多步取模可能落回端点页)', () => {
    // i=count+count=6,count=3 → 页 0,但 active=1 非末页 → 非相邻
    expect(wrapSlidePlan(0, 1, 3)).toBeNull()
  })
})
