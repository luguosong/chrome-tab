import { describe, expect, it } from 'vitest'
import { moveItem } from './arrayUtil'

// 纯函数输入输出断言,无 DOM。主要服务 PageTabs 拖拽重排。

describe('moveItem — 数组元素迁移', () => {
  it('前移到后:moveItem([a,b,c], 0, 2) → [b,c,a]', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a'])
  })

  it('后移到前:moveItem([a,b,c], 2, 0) → [c,a,b]', () => {
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b'])
  })

  it('中间互调:moveItem([a,b,c,d], 1, 2) → [a,c,b,d]', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 1, 2)).toEqual(['a', 'c', 'b', 'd'])
  })

  it('相同索引原样返回', () => {
    expect(moveItem(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'b', 'c'])
  })

  it('不修改原数组(不可变)', () => {
    const src = ['a', 'b', 'c']
    moveItem(src, 0, 2)
    expect(src).toEqual(['a', 'b', 'c'])
  })

  it('越界索引原样返回副本', () => {
    expect(moveItem(['a', 'b'], -1, 0)).toEqual(['a', 'b'])
    expect(moveItem(['a', 'b'], 0, 5)).toEqual(['a', 'b'])
    expect(moveItem(['a', 'b'], 5, 0)).toEqual(['a', 'b'])
  })

  it('单元素数组', () => {
    expect(moveItem(['only'], 0, 0)).toEqual(['only'])
  })

  it('对象数组(保留引用)', () => {
    const a = { id: 1 }
    const b = { id: 2 }
    expect(moveItem([a, b], 0, 1)).toEqual([b, a])
    // 迁移后仍是同一引用
    expect(moveItem([a, b], 0, 1)[1]).toBe(a)
  })
})
