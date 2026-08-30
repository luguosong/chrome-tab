/**
 * 拖拽会话(拖拽编排协议的生命周期层)——CONTEXT.md「拖拽编排」的实现载体之一。
 *
 * 一次拖拽从 onDragStart 到 onDragEnd/onDragCancel 的会话状态机:快照生命周期
 * (拖起即取、cancel/end 回滚时整份回写)、新鲜度策略(icons 一律取事件时刻的
 * env.cacheConfig,不依赖 render 闭包)、会话开始守卫(缓存未就绪不进 dragging——
 * dragging ⇒ 快照非 null ⇒ 缓存非 null 是本模块的不变量)单点于此,表驱动可测。
 * 落点决策(容量门/位序/dwell 手势)仍单点于 iconDrag 的纯决策函数,本模块编排
 * 它们:决策 Action 在此转译为会话 Effect(数据,由 hooks/useDragSession 执行)。
 *
 * DOM-free、零 React 依赖:env 由接线 hook 每次事件时拉取当前聚合缓存传入——
 * 「读缓存而非闭包」由此从 React 隐式行为变成显式输入。
 */
import { dragEndDecision, dragOverDecision, type OverTarget } from './iconDrag'
import { moveIcon } from './iconReducer'
import { moveIntoGroup } from './groupReducer'
import type { Config, Icon } from './types'

// ── 状态与环境 ─────────────────────────────────────────────────────────────

/** 会话状态:idle = 无拖拽(或前提不成立未曾开始)。 */
export type DragSessionState = {
  phase: 'idle' | 'dragging'
  activeId: number | null
  /** dragStart 时刻的聚合缓存:end 比较判跨页 / cancel 与 rollback 整份回写。 */
  snapshot: Config | null
}

/**
 * 每次事件时由接线 hook 拉取的环境(新鲜度契约:决策一律吃这里的当前值,
 * 这是「直接读缓存、不依赖 render 闭包」的显式化)。
 */
export type DragSessionEnv = {
  /** qc.getQueryData<Config>(['config']);null = 缓存未就绪 */
  cacheConfig: Config | null
  editing: boolean
  /** 打开中的分组弹层组行 id(null = 无);开关判定在 end(确已脱离组才关) */
  openGroupId: number | null
}

/** 会话事件(dnd 事件经接线 hook 的最小转译:over 已过 parseOver;start 的
 * activeId 与 over/end 的 draggedId 沿提取源口径从事件重取,不依赖会话态)。 */
export type DragSessionEvent =
  | { type: 'start'; activeId: number | null }
  | { type: 'over'; over: OverTarget; draggedId: number }
  | { type: 'end'; over: OverTarget; draggedId: number; dwellTargetId: number | null }
  | { type: 'cancel' }

export const IDLE: DragSessionState = { phase: 'idle', activeId: null, snapshot: null }

/** 会话输出:状态转换 + 由接线 hook 执行的 Effect 列表(纯数据)。 */
export type DragSessionResult = { state: DragSessionState; effects: DragSessionEffect[] }
export type DragSessionEffect =
  /** 乐观写缓存(决策 action 已应用 moveIcon/moveIntoGroup,接线层一行 setQueryData) */
  | { kind: 'cacheIcons'; icons: Icon[] }
  /** 熄灭合并手势悬停反馈并停计时 */
  | { kind: 'dwellClear' }
  /** 观察悬停(合并手势计时)。编辑门在决策层;手势合格性(eligible)判定在
   *  计时层,icons 为转译时刻的缓存快照(计时层不拉缓存)。 */
  | { kind: 'dwellObserve'; dragged: Icon; startPageId: number; overId: number; overIsPage: boolean; icons: Icon[] }
  /** 短暂提示(容量拒绝/模式提示;文案来自决策层) */
  | { kind: 'notice'; message: string }
  /** 整份回写 dragStart 快照(组员拖出落空/Esc 撤销乐观写入,缓存不留幻影) */
  | { kind: 'restoreSnapshot'; config: Config }
  /** 关闭分组弹层(确已脱离组才关,拖拽中途绝不卸载) */
  | { kind: 'closeOverlay' }
  /** 持久化:顶层/组内移动(parentId 缺省 = 顶层移动;toIndex 语义归移动接口) */
  | { kind: 'commitMove'; id: number; toPageId: number; toIndex: number; parentId?: number }
  /** 持久化:入组(后端忽略 toIndex、恒落组内末尾) */
  | { kind: 'commitIntoGroup'; id: number; toPageId: number; groupId: number }
  /** 持久化:建组(memberIds 有序 = [被拖, 悬停目标],组行继承目标位) */
  | { kind: 'commitMergeGroup'; pageId: number; memberIds: number[] }

// ── reducer ────────────────────────────────────────────────────────────────

/** 会话状态机:输入 (state, event, env),输出新状态与 Effect;无副作用。 */
export function dragSessionEvent(
  state: DragSessionState,
  event: DragSessionEvent,
  env: DragSessionEnv,
): DragSessionResult {
  if (event.type === 'start') {
    // 会话开始守卫:缓存未就绪 / 事件 id 无效(Number()||null 口径)不进 dragging
    if (env.cacheConfig == null || event.activeId == null) return { state, effects: [] }
    return {
      state: { phase: 'dragging', activeId: event.activeId, snapshot: env.cacheConfig },
      effects: [],
    }
  }
  if (event.type === 'over') {
    if (state.phase !== 'dragging' || state.activeId == null) return { state, effects: [] }
    const actions = dragOverDecision({
      icons: env.cacheConfig?.icons ?? null,
      snapshotIcons: state.snapshot?.icons ?? null,
      editing: env.editing,
      over: event.over,
      draggedId: event.draggedId,
    })
    // 决策 Action → 会话 Effect 转译:乐观写在此应用纯 reducer 变成最终 icons,
    // 接线层不再认识 moveIcon/moveIntoGroup;dwell/notice 原样携带决策产物。
    const effects: DragSessionEffect[] = []
    const cacheIcons = env.cacheConfig?.icons ?? null
    let icons: Icon[] | null = null
    for (const action of actions) {
      if (action.type === 'optimisticMove' || action.type === 'optimisticIntoGroup') {
        // 决策在 icons=null 时恒早退,此场景不出现乐观写——判空仅类型设防
        if (cacheIcons == null) continue
        icons =
          action.type === 'optimisticMove'
            ? moveIcon(icons ?? cacheIcons, action)
            : moveIntoGroup(icons ?? cacheIcons, action)
      } else if (action.type === 'clearDwell') {
        effects.push({ kind: 'dwellClear' })
      } else if (action.type === 'updateDwell') {
        effects.push({
          kind: 'dwellObserve',
          dragged: action.dragged,
          startPageId: action.startPageId,
          overId: action.overId,
          overIsPage: action.overIsPage,
          // 转译时刻的缓存快照:手势合格性判定在计时层,吃这里传入的值,
          // 不在执行时再拉缓存(消除对 effect 顺序的隐性依赖)
          icons: cacheIcons ?? [],
        })
      } else if (action.type === 'notice') {
        effects.push({ kind: 'notice', message: action.message })
      }
    }
    if (icons != null) effects.push({ kind: 'cacheIcons', icons })
    return { state, effects }
  }
  if (event.type === 'end') {
    // 松手总会话归 idle;前提不成立(idle / 缓存缺失=不变量破)则诚实空效果,不猜测决策
    if (state.phase !== 'dragging' || state.activeId == null || env.cacheConfig == null) {
      return { state: IDLE, effects: [] }
    }
    const actions = dragEndDecision({
      icons: env.cacheConfig.icons,
      snapshotIcons: state.snapshot?.icons ?? null,
      over: event.over,
      draggedId: event.draggedId,
      dwellTargetId: event.dwellTargetId,
      openGroupId: env.openGroupId,
    })
    const effects: DragSessionEffect[] = []
    for (const action of actions) {
      if (action.type === 'clearDwell') {
        effects.push({ kind: 'dwellClear' })
      } else if (action.type === 'rollback') {
        // 整份回写 dragStart 快照;dragging ⇒ 快照非 null 是 start 守卫保证的不变量
        effects.push({ kind: 'restoreSnapshot', config: state.snapshot! })
      } else if (action.type === 'closeOverlay') {
        effects.push({ kind: 'closeOverlay' })
      } else if (action.type === 'commitIntoGroup') {
        effects.push({ kind: 'commitIntoGroup', id: action.id, toPageId: action.toPageId, groupId: action.groupId })
      } else if (action.type === 'commitMergeGroup') {
        effects.push({ kind: 'commitMergeGroup', pageId: action.pageId, memberIds: action.memberIds })
      } else if (action.type === 'commitMove') {
        effects.push({
          kind: 'commitMove',
          id: action.id,
          toPageId: action.toPageId,
          toIndex: action.toIndex,
          parentId: action.parentId,
        })
      }
    }
    return { state: IDLE, effects }
  }
  if (event.type === 'cancel') {
    // Esc:熄灭悬停反馈 + 整份回写快照(撤销 over 期间的乐观写入,缓存不留幻影)
    if (state.phase !== 'dragging' || state.snapshot == null) return { state: IDLE, effects: [] }
    return {
      state: IDLE,
      effects: [{ kind: 'dwellClear' }, { kind: 'restoreSnapshot', config: state.snapshot }],
    }
  }
  return { state, effects: [] }
}
