import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useUpdateLayoutSettings } from '../api/config'
import {
  applyLayoutField,
  commitLayoutDraft,
  seedLayoutDraft,
  type LayoutDraftState,
} from '../lib/layoutDraft'
import type { Config, LayoutSettings } from '../lib/types'

/**
 * 布局草稿接线(纯协议见 lib/layoutDraft.ts,CONTEXT.md「布局草稿」):
 * 控制抽屉「布局」tab 的暂存态。apply 同步写 stateRef 再 setState——同一 tick 内
 * 「改即提交」的 commit 读 stateRef.current 必得最新值(历史时序 bug 的结构性防线)。
 * 实时预览 = 乐观写 ['config'].layoutSettings,IconGrid/Tile/Clock 等经
 * LayoutSettingsContext 即时反映;seed effect 随 layout prop(服务端权威值派生)
 * reseed,脏门控挡下预览反馈环(apply 写缓存 → prop 变 → seed 被拒)。
 * 持久化与失败回滚在 useUpdateLayoutSettings 选项级回调(卸载后仍生效)。
 */
export function useLayoutDraft(layout: LayoutSettings) {
  const qc = useQueryClient()
  const updateLayout = useUpdateLayoutSettings()
  const [state, setState] = useState<LayoutDraftState>({ draft: layout, dirty: false })
  const stateRef = useRef(state)

  /** 唯一写口:先 ref 后 state,ref 永远领先或等于 render 态。 */
  function update(next: LayoutDraftState) {
    stateRef.current = next
    setState(next)
  }

  function apply<K extends keyof LayoutSettings>(key: K, value: LayoutSettings[K]) {
    const next = applyLayoutField(stateRef.current, key, value)
    update(next)
    qc.setQueryData<Config>(['config'], (prev) =>
      prev ? { ...prev, layoutSettings: next.draft } : prev,
    )
  }

  function commit() {
    const { state: next, persist } = commitLayoutDraft(stateRef.current)
    update(next)
    if (persist) updateLayout.mutate(persist)
  }

  useEffect(() => {
    update(seedLayoutDraft(stateRef.current, layout))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout])

  return { draft: state.draft, apply, commit }
}
