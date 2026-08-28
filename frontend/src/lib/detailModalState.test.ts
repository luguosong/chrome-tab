import { describe, expect, it } from 'vitest'
import { normalizeTab, paneState, type TabItem } from './detailModalState'

/** ADR-0040:详情 Modal 骨架的纯决策函数——tab 归一(悬空回落)与查询状态机归约。 */

describe('normalizeTab', () => {
  const tabs: TabItem[] = [
    { key: 'all', label: '全部' },
    { key: 'cat-3', label: '开发' },
    { key: 'manage', label: '管理' },
  ]

  it('选中项在列 → 原样返回', () => {
    expect(normalizeTab(tabs, 'cat-3')).toBe('cat-3')
    expect(normalizeTab(tabs, 'manage')).toBe('manage')
  })

  it('选中项悬空(所指实体被删,如管理里删掉当前分类)→ 回落首个 tab', () => {
    expect(normalizeTab(tabs, 'cat-7')).toBe('all')
  })

  it('空 tab 列 → 原样返回(调用方约定非空;防御返回不炸渲染)', () => {
    expect(normalizeTab([], 'cat-7')).toBe('cat-7')
  })
})

describe('paneState', () => {
  const base = { isError: false, isPending: false, isEmpty: false, emptyMessage: '这个分类还没有视频' }

  it('isError 优先于一切 → error 态(带域文案)', () => {
    expect(paneState({ ...base, isError: true, isPending: true, isEmpty: true })).toEqual({
      kind: 'error',
      message: '刷新失败',
    })
    expect(paneState({ ...base, isError: true, errorMessage: '新闻流刷新失败' })).toEqual({
      kind: 'error',
      message: '新闻流刷新失败',
    })
  })

  it('无错但尚无数据(首载)→ loading 态(不再误导性地闪空态文案)', () => {
    expect(paneState({ ...base, isPending: true, isEmpty: true })).toEqual({ kind: 'loading' })
  })

  it('数据就位但为空 → empty 态(带域文案)', () => {
    expect(paneState({ ...base, isEmpty: true })).toEqual({
      kind: 'empty',
      message: '这个分类还没有视频',
    })
  })

  it('其余 → content 态', () => {
    expect(paneState(base)).toEqual({ kind: 'content' })
  })
})
