import { describe, expect, it } from 'vitest'
import { DEFAULT_LAYOUT_SETTINGS } from './layoutSettings'
import { applyLayoutField, commitLayoutDraft, seedLayoutDraft } from './layoutDraft'
import type { LayoutSettings } from './types'

/** 已知好基线:与 DEFAULT 刻意取不同值,期望值独立于实现手写。 */
const base: LayoutSettings = {
  ...DEFAULT_LAYOUT_SETTINGS,
  gridWidth: 1200,
  gridGap: 12,
  labelColor: '#aabbcc',
}

describe('applyLayoutField', () => {
  it('更新字段并置 dirty', () => {
    const next = applyLayoutField({ draft: base, dirty: false }, 'clockVisible', false)
    expect(next).toEqual({ draft: { ...base, clockVisible: false }, dirty: true })
  })
})

describe('commitLayoutDraft', () => {
  it('干净草稿不产出载荷(关抽屉/无改动不 PUT)', () => {
    expect(commitLayoutDraft({ draft: base, dirty: false })).toEqual({
      state: { draft: base, dirty: false },
      persist: null,
    })
  })

  it('同 tick apply→commit 载荷携带最新值(改即提交不得读到旧 draft)', () => {
    // 历史 bug 镜像:协议内嵌 ControlDrawer 时,apply 的 setDraft 尚未重渲染、
    // commit 就读了旧 draftRef,改即提交(toggle/下拉)被静默回滚。
    // 纯函数接线约定:hook 在 setState 之前先把产物写回 stateRef,两步读同一 ref。
    let state = { draft: base, dirty: false }
    state = applyLayoutField(state, 'searchEngine', 'bing')
    const { persist } = commitLayoutDraft(state)
    expect(persist).toEqual({ ...base, searchEngine: 'bing' })
  })

  it('apply→commit 清脏后 seed 重新放行(PUT 失败回滚后的 reseed 走此径)', () => {
    // 门控时序:脏时 seed 被挡(预览反馈环),commit 即清脏 —— 回滚还原缓存后
    // layout prop 变化,seed 恰在干净态放行,草稿无脏位残留。无需无条件 reset。
    let state = { draft: base, dirty: false }
    state = applyLayoutField(state, 'clockFont', 64)
    state = commitLayoutDraft(state).state
    expect(state.dirty).toBe(false)
    const server: LayoutSettings = { ...base, gridWidth: 1400 }
    expect(seedLayoutDraft(state, server)).toEqual({ draft: server, dirty: false })
  })
})

describe('seedLayoutDraft', () => {
  const server: LayoutSettings = { ...base, gridWidth: 1400 }

  it('干净态跟随服务端权威值(跨设备改动映入 / PUT 失败回滚后 reseed)', () => {
    expect(seedLayoutDraft({ draft: base, dirty: false }, server)).toEqual({
      draft: server,
      dirty: false,
    })
  })

  it('脏态拒绝跟随(用户动过,本端 LWW 胜出,ADR-0006)', () => {
    const touched = applyLayoutField({ draft: base, dirty: false }, 'gridGap', 4)
    expect(seedLayoutDraft(touched, server)).toBe(touched)
  })
})
