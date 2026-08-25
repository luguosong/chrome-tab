import type { LayoutSettings } from './types'

/**
 * 布局草稿协议(见 CONTEXT.md「布局草稿」)纯函数:控制抽屉「布局」tab 的
 * 暂存态状态机 —— apply 置脏、commit 依脏门控产出持久化载荷、seed 在干净态
 * 跟随服务端权威值。历史上此协议内嵌在 ControlDrawer 时发生过「改即提交读到
 * 旧 draft」的时序 bug(ref 回写晚于 commit);收进纯函数后该类 bug 在构造上
 * 不可能 —— 输入即全部状态,无隐藏时序。useLayoutDraft hook 是唯一接线方。
 */
export type LayoutDraftState = { draft: LayoutSettings; dirty: boolean }

/** commit 产物:清脏后的新状态 + 待 PUT 载荷(干净草稿为 null,接线方据此跳过 PUT)。 */
export type LayoutCommit = { state: LayoutDraftState; persist: LayoutSettings | null }

/** 草稿改一字段并置脏(实时预览与松手提交共用同一条改口)。 */
export function applyLayoutField<K extends keyof LayoutSettings>(
  state: LayoutDraftState,
  key: K,
  value: LayoutSettings[K],
): LayoutDraftState {
  return { draft: { ...state.draft, [key]: value }, dirty: true }
}

/** 脏草稿产出整份 draft 并清脏;干净草稿原样返回、不产出载荷(dirty 守卫避免无谓 PUT)。 */
export function commitLayoutDraft(state: LayoutDraftState): LayoutCommit {
  if (!state.dirty) return { state, persist: null }
  return { state: { draft: state.draft, dirty: false }, persist: state.draft }
}

/**
 * 服务端权威值映入草稿,仅干净态放行(跨设备改动 / PUT 失败回滚后的 reseed)。
 * 脏态原样返回:用户动过,关抽屉时按本端 LWW 覆盖(ADR-0006)——
 * 也保证了预览反馈环安全(apply 乐观写缓存 → layout prop 变 → seed 被脏门挡下)。
 */
export function seedLayoutDraft(
  state: LayoutDraftState,
  server: LayoutSettings,
): LayoutDraftState {
  return state.dirty ? state : { draft: server, dirty: false }
}
