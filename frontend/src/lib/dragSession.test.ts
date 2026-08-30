import { describe, expect, it } from 'vitest'
import { IDLE, dragSessionEvent, type DragSessionEnv } from './dragSession'
import type { Config, Icon, LayoutSettings } from './types'

// 拖拽会话(一次拖拽从 start 到 end/cancel 的状态与协议,CONTEXT.md「拖拽编排」的
// 生命周期层)的表驱动测试。落点决策细节(容量门/位序/dwell 手势/编辑门)已由
// iconDrag.test.ts 的表驱动用例锁定;本文件只测会话层的自有输出:状态转换
// (开始守卫/idle 免疫/归位)、快照生命周期(取/读/回写)、新鲜度(icons 来源=
// 事件时刻 env 缓存,非快照非闭包)。

let seq = 0
function mkIcon(pageId: number, opts: Partial<Icon> = {}): Icon {
  return {
    id: ++seq,
    pageId,
    parentId: null,
    type: 'nav',
    sortOrder: 0,
    data: null,
    ...opts,
  }
}

const LAYOUT: LayoutSettings = { } as LayoutSettings // 会话层不读布局,占位即可
function mkConfig(icons: Icon[] = [mkIcon(1)], pages = [{ id: 1, name: 'P1', sortOrder: 0 }]): Config {
  return { pages, icons, layoutSettings: LAYOUT, updatedAt: '2026-08-30T00:00:00Z' }
}

function env(overrides: Partial<DragSessionEnv> = {}): DragSessionEnv {
  return { cacheConfig: mkConfig(), editing: true, openGroupId: null, ...overrides }
}

// ── start:会话开始守卫 ─────────────────────────────────────────────────────

describe('dragSession — start(会话开始)', () => {
  it('缓存就绪 → 进 dragging,快照 dragStart 时刻的聚合缓存', () => {
    const config = mkConfig()
    const r = dragSessionEvent(IDLE, { type: 'start', activeId: 7 }, env({ cacheConfig: config }))
    expect(r.state).toEqual({ phase: 'dragging', activeId: 7, snapshot: config })
    expect(r.effects).toEqual([])
  })

  it('缓存未就绪 → 会话不开始(乐观写与幽灵渲染的前提不成立,停在 idle)', () => {
    const r = dragSessionEvent(IDLE, { type: 'start', activeId: 7 }, env({ cacheConfig: null }))
    expect(r.state).toEqual(IDLE)
    expect(r.effects).toEqual([])
  })
})

// ── over:乐观搬移转译与 idle 免疫 ─────────────────────────────────────────

/** 跨页场景:页1 = A(id1)+C(id3),页2 = B(id2)。拖 A 悬到页 2 的 B 上。 */
function twoPageConfig(): Config {
  return mkConfig(
    [
      mkIcon(1, { id: 1, sortOrder: 0 }),
      mkIcon(2, { id: 2, sortOrder: 0 }),
      mkIcon(1, { id: 3, sortOrder: 1 }),
    ],
    [
      { id: 1, name: 'P1', sortOrder: 0 },
      { id: 2, name: 'P2', sortOrder: 1 },
    ],
  )
}

describe('dragSession — over(拖拽中的乐观搬移转译)', () => {
  const overOnB = { kind: 'icon', pageId: 2, numericOverId: 2 } as const

  function draggingWith(config: Config) {
    return dragSessionEvent(IDLE, { type: 'start', activeId: 1 }, env({ cacheConfig: config })).state
  }

  it('idle 免疫:会话未开始时 over 不产生任何效果、状态不变', () => {
    const r = dragSessionEvent(IDLE, { type: 'over', over: overOnB, draggedId: 1 }, env())
    expect(r.state).toEqual(IDLE)
    expect(r.effects).toEqual([])
  })

  it('跨页落点 → cacheIcons:被拖项乐观移入目标页(moveIcon 语义,目标页顶层重排)', () => {
    const config = twoPageConfig()
    const state = draggingWith(config)
    const r = dragSessionEvent(state, { type: 'over', over: overOnB, draggedId: 1 }, env({ cacheConfig: config }))
    expect(r.state).toEqual(state) // over 不改会话状态(快照/activeId 原样)
    const writes = r.effects.filter((e) => e.kind === 'cacheIcons')
    expect(writes).toHaveLength(1)
    if (writes[0].kind !== 'cacheIcons') return
    // 独立期望(moveIcon 领域语义):A 落页2 首位,B 被挤到 1;源页 C 留洞不动
    const byId = new Map(writes[0].icons.map((i) => [i.id, i]))
    expect(byId.get(1)).toMatchObject({ pageId: 2, sortOrder: 0 })
    expect(byId.get(2)).toMatchObject({ pageId: 2, sortOrder: 1 })
    expect(byId.get(3)).toMatchObject({ pageId: 1, sortOrder: 1 })
  })

  it('新鲜度:决策吃事件时刻 env.cacheConfig(乐观链中途的第二次 over 按已写态续算)', () => {
    const config = twoPageConfig()
    const state = draggingWith(config)
    // 第一次 over:A 乐观移入页 2;接线层把 effects 应用进缓存,第二次 over 的 env 携带已写态
    const first = dragSessionEvent(state, { type: 'over', over: overOnB, draggedId: 1 }, env({ cacheConfig: config }))
    const write = first.effects.find((e) => e.kind === 'cacheIcons')
    const written = write?.kind === 'cacheIcons' ? write.icons : []
    // 同落点再 over:被拖项已在目标页(dragged.pageId === targetPageId)→ 决策同页早退,无乐观写
    const second = dragSessionEvent(state, { type: 'over', over: overOnB, draggedId: 1 }, env({ cacheConfig: { ...config, icons: written } }))
    expect(second.effects.filter((e) => e.kind === 'cacheIcons')).toEqual([])
  })

  it('over 空/边缘 → dwellClear(悬停反馈熄灭,无乐观写)', () => {
    const config = twoPageConfig()
    const state = draggingWith(config)
    const r = dragSessionEvent(state, { type: 'over', over: { kind: 'none', numericOverId: null }, draggedId: 1 }, env({ cacheConfig: config }))
    expect(r.effects).toEqual([{ kind: 'dwellClear' }])
  })

  it('编辑态悬停同页图标 → dwellObserve 携带手势参数与转译时刻缓存快照(编辑门在决策层)', () => {
    const config = twoPageConfig()
    const state = draggingWith(config)
    // 悬停到同页(页 1)的 C(id3)上:决策发 updateDwell(编辑门已上提决策层)
    const r = dragSessionEvent(
      state,
      { type: 'over', over: { kind: 'icon', pageId: 1, numericOverId: 3 }, draggedId: 1 },
      env({ cacheConfig: config, editing: true }),
    )
    const dragged = config.icons.find((i) => i.id === 1)!
    expect(r.effects).toEqual([
      { kind: 'dwellObserve', dragged, startPageId: 1, overId: 3, overIsPage: false, icons: config.icons },
    ])
  })

  it('查看态组员拖出 → 仅 notice(编辑门在决策层,无 dwellObserve)', () => {
    const member = mkIcon(1, { id: 5, parentId: 9, sortOrder: 0 })
    const config = mkConfig([
      member,
      mkIcon(1, { id: 1, sortOrder: 1 }),
      mkIcon(2, { id: 2, sortOrder: 0 }),
    ])
    const state = dragSessionEvent(IDLE, { type: 'start', activeId: 5 }, env({ cacheConfig: config })).state
    const r = dragSessionEvent(
      state,
      { type: 'over', over: overOnB, draggedId: 5 },
      env({ cacheConfig: config, editing: false }),
    )
    expect(r.effects).toEqual([{ kind: 'notice', message: '移出分组需先右键进入编辑模式' }])
  })
})

// ── end:提交/回滚/关弹层与归位 ─────────────────────────────────────────────

describe('dragSession — end(松手收尾)', () => {
  /** start A(页1)→ over 移入页 2(落 B 上):缓存已含乐观终态。 */
  function draggedAcrossToPage2() {
    const config = twoPageConfig()
    const env0 = env({ cacheConfig: config })
    const dragging = dragSessionEvent(IDLE, { type: 'start', activeId: 1 }, env0).state
    const over = dragSessionEvent(
      dragging,
      { type: 'over', over: { kind: 'icon', pageId: 2, numericOverId: 2 }, draggedId: 1 },
      env0,
    )
    const written = over.effects.find((e) => e.kind === 'cacheIcons')
    return {
      snapshot: config,
      cacheConfig: written?.kind === 'cacheIcons' ? { ...config, icons: written.icons } : config,
      dragging,
    }
  }

  it('跨页松手 → commitMove 按缓存最终态提交,会话归 idle', () => {
    const { dragging, cacheConfig } = draggedAcrossToPage2()
    const r = dragSessionEvent(
      dragging,
      { type: 'end', over: { kind: 'icon', pageId: 2, numericOverId: 2 }, draggedId: 1, dwellTargetId: null },
      env({ cacheConfig }),
    )
    expect(r.state).toEqual(IDLE)
    expect(r.effects).toContainEqual({ kind: 'commitMove', id: 1, toPageId: 2, toIndex: 0 })
  })

  it('组员拖出后落空 → restoreSnapshot 整份回写 dragStart 快照(不留幻影),会话归 idle', () => {
    const member = mkIcon(1, { id: 5, parentId: 9, sortOrder: 0 })
    const config = mkConfig([member, mkIcon(1, { id: 1, sortOrder: 1 }), mkIcon(2, { id: 2, sortOrder: 0 })])
    const env0 = env({ cacheConfig: config, editing: true })
    const dragging = dragSessionEvent(IDLE, { type: 'start', activeId: 5 }, env0).state
    // 乐观移出:over 落页 2 图标(编辑态,组员恒 1 格容量门过)
    const moved = dragSessionEvent(
      dragging,
      { type: 'over', over: { kind: 'icon', pageId: 2, numericOverId: 2 }, draggedId: 5 },
      env0,
    )
    const written = moved.effects.find((e) => e.kind === 'cacheIcons')
    // 松手落空(over none):start.parentId=9 且 current.parentId=null 且不在页面网格 → 回滚
    const r = dragSessionEvent(
      dragging,
      { type: 'end', over: { kind: 'none', numericOverId: null }, draggedId: 5, dwellTargetId: null },
      env({ cacheConfig: written?.kind === 'cacheIcons' ? { ...config, icons: written.icons } : config }),
    )
    expect(r.state).toEqual(IDLE)
    expect(r.effects).toEqual([{ kind: 'restoreSnapshot', config }])
  })

  it('组员拖出落页面网格且弹层开 → closeOverlay 与提交同发,会话归 idle', () => {
    const member = mkIcon(1, { id: 5, parentId: 9, sortOrder: 0 })
    const top = [mkIcon(1, { id: 1, sortOrder: 1 }), mkIcon(2, { id: 2, sortOrder: 0 })]
    const config = mkConfig([member, ...top])
    const env0 = env({ cacheConfig: config, editing: true, openGroupId: 9 })
    const dragging = dragSessionEvent(IDLE, { type: 'start', activeId: 5 }, env0).state
    const moved = dragSessionEvent(
      dragging,
      { type: 'over', over: { kind: 'icon', pageId: 1, numericOverId: 1 }, draggedId: 5 },
      env0,
    )
    const written = moved.effects.find((e) => e.kind === 'cacheIcons')
    const r = dragSessionEvent(
      dragging,
      { type: 'end', over: { kind: 'icon', pageId: 1, numericOverId: 1 }, draggedId: 5, dwellTargetId: null },
      env({ cacheConfig: written?.kind === 'cacheIcons' ? { ...config, icons: written.icons } : config, openGroupId: 9 }),
    )
    expect(r.state).toEqual(IDLE)
    expect(r.effects).toContainEqual({ kind: 'closeOverlay' })
    // 同页落点提交:乐观移出后页 1 顶层序为 [5, 1],落点 id=1 位序 1(parentId 缺省 = 顶层移动)
    expect(r.effects).toContainEqual({ kind: 'commitMove', id: 5, toPageId: 1, toIndex: 1 })
  })

  it('dwell 达标且指针仍在目标 → dwellClear + commitMergeGroup(建组)', () => {
    const config = twoPageConfig()
    const dragging = dragSessionEvent(IDLE, { type: 'start', activeId: 1 }, env({ cacheConfig: config })).state
    // 拖 A(id1)悬 C(id3,同页1)达标后松手仍在 C 上
    const r = dragSessionEvent(
      dragging,
      { type: 'end', over: { kind: 'icon', pageId: 1, numericOverId: 3 }, draggedId: 1, dwellTargetId: 3 },
      env({ cacheConfig: config }),
    )
    expect(r.state).toEqual(IDLE)
    expect(r.effects).toEqual([
      { kind: 'dwellClear' },
      { kind: 'commitMergeGroup', pageId: 1, memberIds: [1, 3] },
    ])
  })

  it('dwell 达标且指针在组上 → dwellClear + commitIntoGroup(入组)', () => {
    const config = mkConfig([
      mkIcon(1, { id: 1, sortOrder: 0 }),
      mkIcon(1, { id: 9, type: 'group', sortOrder: 1 }),
    ])
    const dragging = dragSessionEvent(IDLE, { type: 'start', activeId: 1 }, env({ cacheConfig: config })).state
    const r = dragSessionEvent(
      dragging,
      { type: 'end', over: { kind: 'icon', pageId: 1, numericOverId: 9 }, draggedId: 1, dwellTargetId: 9 },
      env({ cacheConfig: config }),
    )
    expect(r.effects).toEqual([
      { kind: 'dwellClear' },
      { kind: 'commitIntoGroup', id: 1, toPageId: 1, groupId: 9 },
    ])
  })

  it('组内重排 → commitMove 携带 parentId(组内序列提交)', () => {
    const m5 = mkIcon(1, { id: 5, parentId: 9, sortOrder: 0 })
    const m6 = mkIcon(1, { id: 6, parentId: 9, sortOrder: 1 })
    const config = mkConfig([m5, m6])
    const dragging = dragSessionEvent(IDLE, { type: 'start', activeId: 5 }, env({ cacheConfig: config })).state
    // 组内拖 5 到 6 上:over 落点在弹层容器内(groupOverlay),同组未拖出走组内重排
    const r = dragSessionEvent(
      dragging,
      { type: 'end', over: { kind: 'groupOverlay', groupId: 9, numericOverId: 6 }, draggedId: 5, dwellTargetId: null },
      env({ cacheConfig: config }),
    )
    expect(r.effects).toEqual([
      { kind: 'commitMove', id: 5, toPageId: 1, toIndex: 1, parentId: 9 },
    ])
  })

  it('idle 或缓存缺失(不变量破)→ 归 idle 无效果,不猜测决策', () => {
    const idleEnd = dragSessionEvent(IDLE, { type: 'end', over: { kind: 'none', numericOverId: null }, draggedId: 1, dwellTargetId: null }, env())
    expect(idleEnd).toEqual({ state: IDLE, effects: [] })
    const { dragging } = draggedAcrossToPage2()
    const noCache = dragSessionEvent(dragging, { type: 'end', over: { kind: 'icon', pageId: 2, numericOverId: 2 }, draggedId: 1, dwellTargetId: null }, env({ cacheConfig: null }))
    expect(noCache).toEqual({ state: IDLE, effects: [] })
  })
})

// ── cancel:Esc 撤销 ────────────────────────────────────────────────────────

describe('dragSession — cancel(Esc 整份回滚)', () => {
  it('dragging 中取消 → dwellClear + restoreSnapshot 整份回写快照,归 idle', () => {
    const config = twoPageConfig()
    const dragging = dragSessionEvent(IDLE, { type: 'start', activeId: 1 }, env({ cacheConfig: config })).state
    const r = dragSessionEvent(dragging, { type: 'cancel' }, env({ cacheConfig: config }))
    expect(r.state).toEqual(IDLE)
    expect(r.effects).toEqual([{ kind: 'dwellClear' }, { kind: 'restoreSnapshot', config }])
  })

  it('idle 取消 → 无效果(防御:会话外 Esc 与会话无关)', () => {
    expect(dragSessionEvent(IDLE, { type: 'cancel' }, env())).toEqual({ state: IDLE, effects: [] })
  })
})

