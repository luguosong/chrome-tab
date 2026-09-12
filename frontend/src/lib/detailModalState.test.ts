import { describe, expect, it } from 'vitest'
import { normalizeTab, paneState, settleTabs, type TabItem } from './detailModalState'

/** ADR-0040:详情 Modal 骨架的纯决策函数——tab 归一(悬空回落)与查询状态机归约。
 *  settleTabs(行壳票 01):数据派生 tab 域的「派生 + 管理追加 + 归一 + 门控」仪式收编。 */

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

describe('settleTabs', () => {
  // 形如新闻/视频的数据派生域:全部 → 各实体(源/分类)……;manage 由惯例追加
  const base: TabItem<'all' | `src-${number}` | 'manage'>[] = [
    { key: 'all', label: '全部' },
    { key: 'src-1', label: '源一' },
    { key: 'src-2', label: '源二' },
  ]

  it('manageLabel 传入 → 管理tab 追加在尾,选中归一', () => {
    const s = settleTabs(base, 'src-1', '管理')
    expect(s.tabs).toEqual([...base, { key: 'manage', label: '管理' }])
    expect(s.active).toBe('src-1')
    expect(s.isManage).toBe(false)
  })

  it('选中管理tab → isManage 真(pane 门控信号)', () => {
    expect(settleTabs(base, 'manage', '管理').isManage).toBe(true)
  })

  it('选中悬空(所指实体被删)→ 回落首个 tab,isManage 假', () => {
    const s = settleTabs(base, 'src-7', '管理')
    expect(s.active).toBe('all')
    expect(s.isManage).toBe(false)
  })

  it('manageLabel 缺省(服务器状态等无管理tab 域)→ 原样,不追加', () => {
    const s = settleTabs(base, 'src-2')
    expect(s.tabs).toEqual(base)
    expect(s.active).toBe('src-2')
    expect(s.isManage).toBe(false)
  })

  it('空 base + manageLabel → 仅管理tab(数据未到时管理仍可达,pane 恒 null 形)', () => {
    const s = settleTabs([], 'all', '管理')
    expect(s.tabs).toEqual([{ key: 'manage', label: '管理' }])
    expect(s.active).toBe('manage')
    expect(s.isManage).toBe(true)
  })

  it('不修改入参(base 只读,追加走拷贝)', () => {
    const frozen = Object.freeze([...base])
    expect(() => settleTabs(frozen, 'all', '管理')).not.toThrow()
    expect(frozen).toEqual(base)
  })
})
