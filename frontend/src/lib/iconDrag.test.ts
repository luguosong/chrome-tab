import { describe, expect, it } from 'vitest'
import {
  EDGE_DROP_ID,
  collisionDetection,
  dragEndDecision,
  dragOverDecision,
  parseOver,
  type OverLike,
} from './iconDrag'
import type { Icon } from './types'

// 拖拽编排(拖拽期间乐观缓存流的协议)的表驱动测试。
// 用例注释里的行号指提取源 DashboardPage(本文件所在 commit 的父版本),落地后以 git 历史为准。
// DOM-free:决策函数吃纯数据 ctx,返回 Action 由接线层执行。

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

// ── parseOver:over 事件解析 adapter ──────────────────────────────────────

describe('parseOver — over 事件解析(隐式约定单点)', () => {
  it('over 为空 → none(handleDragOver 227 / handleDragEnd 389)', () => {
    expect(parseOver(null)).toEqual({ kind: 'none', numericOverId: null })
    expect(parseOver(undefined)).toEqual({ kind: 'none', numericOverId: null })
  })

  it('边缘翻页区 id → edge(EDGE_DROP_ID,231 行)', () => {
    expect(parseOver({ id: EDGE_DROP_ID.left })).toEqual({ kind: 'edge', numericOverId: null })
    expect(parseOver({ id: EDGE_DROP_ID.right })).toEqual({ kind: 'edge', numericOverId: null })
  })

  it('data.type=page → page(空页 droppable,PageDropArea,244-245 行)', () => {
    expect(parseOver({ id: '5', data: { current: { type: 'page', pageId: 5 } } })).toEqual({
      kind: 'page',
      pageId: 5,
      numericOverId: 5,
    })
  })

  it('containerId=group-{id} → groupOverlay(254-256 行)', () => {
    expect(
      parseOver({ id: '12', data: { current: { sortable: { containerId: 'group-7' } } } }),
    ).toEqual({ kind: 'groupOverlay', groupId: 7, numericOverId: 12 })
  })

  it('同时带 page 类型与组容器 id → 弹层优先(提取源的判定顺序)', () => {
    expect(
      parseOver({
        id: '12',
        data: { current: { type: 'page', pageId: 3, sortable: { containerId: 'group-7' } } },
      }),
    ).toEqual({ kind: 'groupOverlay', groupId: 7, numericOverId: 12 })
  })

  it('普通图标 → icon + 容器页 id(319-322 行)', () => {
    expect(
      parseOver({ id: '12', data: { current: { sortable: { containerId: '3' } } } }),
    ).toEqual({ kind: 'icon', pageId: 3, numericOverId: 12 })
  })

  it('图标落点但 containerId 缺失/非数值 → icon + pageId null(320-321 行守卫)', () => {
    expect(parseOver({ id: '12' })).toEqual({
      kind: 'icon',
      pageId: null,
      numericOverId: 12,
    })
    expect(
      parseOver({ id: '12', data: { current: { sortable: { containerId: 'abc' } } } }),
    ).toEqual({ kind: 'icon', pageId: null, numericOverId: 12 })
  })
})

// ── dragOverDecision ──────────────────────────────────────────────────────

function overCtx(over: OverLike, extra: Record<string, unknown> = {}) {
  return {
    icons: null as Icon[] | null,
    snapshotIcons: null as Icon[] | null,
    editing: true,
    over: parseOver(over),
    draggedId: 1,
    ...extra,
  }
}

describe('dragOverDecision — 早退分支', () => {
  it('over 空 → 熄灭 dwell(227-230)', () => {
    expect(dragOverDecision(overCtx(null))).toEqual([{ type: 'clearDwell' }])
  })

  it('边缘落点 → 熄灭 dwell,不处理落点(231-234)', () => {
    expect(dragOverDecision(overCtx({ id: EDGE_DROP_ID.left }))).toEqual([{ type: 'clearDwell' }])
  })

  it('缓存为空 / 被拖项不存在 → 无动作(237-240)', () => {
    expect(dragOverDecision(overCtx({ id: '2', data: { current: { sortable: { containerId: '1' } } } }))).toEqual([])
    expect(
      dragOverDecision(
        overCtx({ id: '2', data: { current: { sortable: { containerId: '1' } } } }, {
          icons: [mkIcon(1, { id: 9 })],
          draggedId: 2,
        }),
      ),
    ).toEqual([])
  })
})

describe('dragOverDecision — 组弹层落点(248-269)', () => {
  const over = { id: '5', data: { current: { sortable: { containerId: 'group-9' } } } }

  it('被拖项已乐观搬出(startParent=该组,现顶层)→ 搬回组', () => {
    const dragged = mkIcon(1, { id: 5, parentId: null })
    const actions = dragOverDecision(
      overCtx(over, { icons: [dragged], snapshotIcons: [mkIcon(1, { id: 5, parentId: 9 })], draggedId: 5 }),
    )
    expect(actions).toEqual([
      { type: 'clearDwell' },
      { type: 'optimisticIntoGroup', id: 5, groupId: 9 },
    ])
  })

  it('快照守卫不匹配(普通网格图标)→ 仅熄灭 dwell,不入组', () => {
    const dragged = mkIcon(1, { id: 5, parentId: null })
    expect(
      dragOverDecision(overCtx(over, {
        icons: [dragged],
        snapshotIcons: [mkIcon(1, { id: 5, parentId: null })],
        draggedId: 5,
      })),
    ).toEqual([{ type: 'clearDwell' }])
  })

  it('被拖项仍在组内(parentId 非空)→ 仅熄灭 dwell(261 行守卫)', () => {
    const dragged = mkIcon(1, { id: 5, parentId: 9 })
    expect(
      dragOverDecision(overCtx(over, { icons: [dragged], snapshotIcons: [dragged], draggedId: 5 })),
    ).toEqual([{ type: 'clearDwell' }])
  })
})

describe('dragOverDecision — 组成员拖出(275-304)', () => {
  // 目标页 2:两个顶层图标(sortOrder 0/1),满页构造见容量用例
  const targetIcons = [mkIcon(2, { id: 11, sortOrder: 0 }), mkIcon(2, { id: 12, sortOrder: 1 })]
  const dragged = mkIcon(1, { id: 5, parentId: 9 })
  const base = {
    icons: [dragged, ...targetIcons],
    snapshotIcons: [dragged],
    draggedId: 5,
  }
  const iconOver = { id: '12', data: { current: { sortable: { containerId: '2' } } } }

  it('查看态 → 提示,不发 dwell(284-287;编辑门上提:此前 hook 内拦,行为等价)', () => {
    expect(
      dragOverDecision(overCtx(iconOver, { ...base, editing: false })),
    ).toEqual([{ type: 'notice', message: '移出分组需先右键进入编辑模式' }])
  })

  it('编辑态 + 落图标 over → 落 over 位序移出(288-303)', () => {
    expect(dragOverDecision(overCtx(iconOver, base))).toEqual([
      { type: 'updateDwell', dragged, startPageId: 1, overId: 12, overIsPage: false },
      { type: 'optimisticMove', id: 5, toPageId: 2, toIndex: 1 },
    ])
  })

  it('编辑态 + 落空页 over → 落点非成员,追加末尾(298-302 的 -1 → append)', () => {
    const pageOver = { id: '2', data: { current: { type: 'page', pageId: 2 } } }
    expect(dragOverDecision(overCtx(pageOver, base))).toEqual([
      { type: 'updateDwell', dragged, startPageId: 1, overId: 2, overIsPage: true },
      { type: 'optimisticMove', id: 5, toPageId: 2, toIndex: 2 },
    ])
  })

  it('目标页满(容量门不带被拖格数:组员恒 1 格,294)→ 提示', () => {
    const full = Array.from({ length: 81 }, (_, k) => mkIcon(2, { id: 100 + k, sortOrder: k }))
    expect(
      dragOverDecision(overCtx(iconOver, { ...base, icons: [dragged, ...full] })),
    ).toEqual([
      { type: 'updateDwell', dragged, startPageId: 1, overId: 12, overIsPage: false },
      { type: 'notice', message: '目标页已满,无法移出' },
    ])
  })
})

describe('dragOverDecision — 顶层跨页(空页落点 306-317 / 图标落点 319-345)', () => {
  const dragged = mkIcon(1, { id: 5 })
  const targetIcons = [mkIcon(2, { id: 11, sortOrder: 0 }), mkIcon(2, { id: 12, sortOrder: 1 })]
  const base = { icons: [dragged, ...targetIcons], snapshotIcons: [dragged], draggedId: 5 }

  it('空页落点(异页)→ 位序 0 移入(307-315)', () => {
    const pageOver = { id: '2', data: { current: { type: 'page', pageId: 2 } } }
    expect(dragOverDecision(overCtx(pageOver, base))).toEqual([
      { type: 'updateDwell', dragged, startPageId: 1, overId: 2, overIsPage: true },
      { type: 'optimisticMove', id: 5, toPageId: 2, toIndex: 0 },
    ])
  })

  it('空页落点(同页)→ 仅 dwell,不移(308)', () => {
    const pageOver = { id: '1', data: { current: { type: 'page', pageId: 1 } } }
    expect(dragOverDecision(overCtx(pageOver, base))).toEqual([
      { type: 'updateDwell', dragged, startPageId: 1, overId: 1, overIsPage: true },
    ])
  })

  it('空页落点 + 目标页满(容量门带被拖格数,311)→ 提示', () => {
    const full = Array.from({ length: 81 }, (_, k) => mkIcon(2, { id: 100 + k, sortOrder: k }))
    const pageOver = { id: '2', data: { current: { type: 'page', pageId: 2 } } }
    expect(dragOverDecision(overCtx(pageOver, { ...base, icons: [dragged, ...full] }))).toEqual([
      { type: 'updateDwell', dragged, startPageId: 1, overId: 2, overIsPage: true },
      { type: 'notice', message: '目标页已满,无法移入' },
    ])
  })

  it('图标落点(异页)→ 落 over 位序(328-345)', () => {
    const iconOver = { id: '12', data: { current: { sortable: { containerId: '2' } } } }
    expect(dragOverDecision(overCtx(iconOver, base))).toEqual([
      { type: 'updateDwell', dragged, startPageId: 1, overId: 12, overIsPage: false },
      { type: 'optimisticMove', id: 5, toPageId: 2, toIndex: 1 },
    ])
  })

  it('图标落点(同页)→ 仅 dwell,交给落点提交(323)', () => {
    const iconOver = { id: '12', data: { current: { sortable: { containerId: '1' } } } }
    expect(dragOverDecision(overCtx(iconOver, base))).toEqual([
      { type: 'updateDwell', dragged, startPageId: 1, overId: 12, overIsPage: false },
    ])
  })

  it('图标落点 + containerId 缺失 → 仅 dwell(320-321)', () => {
    expect(dragOverDecision(overCtx({ id: '12' }, base))).toEqual([
      { type: 'updateDwell', dragged, startPageId: 1, overId: 12, overIsPage: false },
    ])
  })

  it('跨格类型按格数计容量:占 76 格的页拒 aihot(6 格,76+6>81)', () => {
    const big = mkIcon(1, { id: 5, type: 'aihot' })
    const almost = Array.from({ length: 76 }, (_, k) => mkIcon(2, { id: 30 + k, sortOrder: k }))
    const pageOver = { id: '2', data: { current: { type: 'page', pageId: 2 } } }
    expect(
      dragOverDecision(overCtx(pageOver, { icons: [big, ...almost], snapshotIcons: [big], draggedId: 5 })),
    ).toEqual([
      { type: 'updateDwell', dragged: big, startPageId: 1, overId: 2, overIsPage: true },
      { type: 'notice', message: '目标页已满,无法移入' },
    ])
  })

  it('目标页过滤含组内成员的现状差异(310 行不滤 parentId,靠 canFit 内部兜住)', () => {
    // 目标页 2:1 顶层 + 1 组内成员。310 行 filter 不带 parentId===null,
    // toIndex 计数却基于滤过 parentId 的序列(328-330)——本用例钉住该现状差异:
    // 容量以顶层计(成员不计,canFit 内部 cellsUsed 跳过),可移入且位序按顶层序列。
    const member = mkIcon(2, { id: 40, parentId: 9, sortOrder: 5 })
    const iconOver = { id: '11', data: { current: { sortable: { containerId: '2' } } } }
    expect(dragOverDecision(overCtx(iconOver, { ...base, icons: [dragged, targetIcons[0], member] }))).toEqual([
      { type: 'updateDwell', dragged, startPageId: 1, overId: 11, overIsPage: false },
      { type: 'optimisticMove', id: 5, toPageId: 2, toIndex: 0 },
    ])
  })
})

// ── dragEndDecision ───────────────────────────────────────────────────────

function endCtx(over: OverLike, extra: Record<string, unknown> = {}) {
  return {
    icons: [] as Icon[],
    snapshotIcons: null as Icon[] | null,
    over: parseOver(over),
    draggedId: 1,
    dwellTargetId: null as number | null,
    openGroupId: null as number | null,
    ...extra,
  }
}

describe('dragEndDecision — 前置守卫与 dwell 收尾(347-384)', () => {
  it('当前缓存 / 快照缺被拖项 → 无动作(356-358)', () => {
    expect(dragEndDecision(endCtx(null))).toEqual([])
    expect(
      dragEndDecision(endCtx({ id: '2', data: { current: { sortable: { containerId: '1' } } } }, {
        icons: [mkIcon(1, { id: 9 })],
        draggedId: 2,
      })),
    ).toEqual([])
  })

  it('dwell 达标且指针仍在目标(组)→ 入组提交(368-374)', () => {
    const dragged = mkIcon(1, { id: 5 })
    const group = mkIcon(1, { id: 9, type: 'group', sortOrder: 2 })
    const iconOver = { id: '9', data: { current: { sortable: { containerId: '1' } } } }
    expect(
      dragEndDecision(endCtx(iconOver, {
        icons: [dragged, group],
        snapshotIcons: [dragged],
        draggedId: 5,
        dwellTargetId: 9,
      })),
    ).toEqual([
      { type: 'clearDwell' },
      { type: 'commitIntoGroup', id: 5, toPageId: 1, groupId: 9 },
    ])
  })

  it('dwell 达标且目标非组 → 建组提交,memberIds=[被拖 A, 悬停 B](375-381)', () => {
    const dragged = mkIcon(1, { id: 5 })
    const other = mkIcon(1, { id: 6, sortOrder: 1 })
    const iconOver = { id: '6', data: { current: { sortable: { containerId: '1' } } } }
    expect(
      dragEndDecision(endCtx(iconOver, {
        icons: [dragged, other],
        snapshotIcons: [dragged],
        draggedId: 5,
        dwellTargetId: 6,
      })),
    ).toEqual([
      { type: 'clearDwell' },
      { type: 'commitMergeGroup', pageId: 1, memberIds: [5, 6] },
    ])
  })

  it('dwell 达标但已拖离(over ≠ dwell 目标)→ 熄灭后落回排序逻辑(360-363)', () => {
    const dragged = mkIcon(1, { id: 5 })
    const other = mkIcon(1, { id: 6, sortOrder: 1 })
    const third = mkIcon(1, { id: 7, sortOrder: 2 })
    const iconOver = { id: '7', data: { current: { sortable: { containerId: '1' } } } }
    expect(
      dragEndDecision(endCtx(iconOver, {
        icons: [dragged, other, third],
        snapshotIcons: [dragged],
        draggedId: 5,
        dwellTargetId: 6,
      })),
    ).toEqual([
      { type: 'clearDwell' },
      { type: 'commitMove', id: 5, toPageId: 1, toIndex: 2 },
    ])
  })

  it('dwell 未达标 → 无 clearDwell(363 行 if 守卫)', () => {
    const dragged = mkIcon(1, { id: 5 })
    const other = mkIcon(1, { id: 6, sortOrder: 1 })
    const iconOver = { id: '6', data: { current: { sortable: { containerId: '1' } } } }
    expect(
      dragEndDecision(endCtx(iconOver, {
        icons: [dragged, other],
        snapshotIcons: [dragged],
        draggedId: 5,
      })),
    ).toEqual([{ type: 'commitMove', id: 5, toPageId: 1, toIndex: 1 }])
  })
})

describe('dragEndDecision — 弹层回滚与组内重排(386-416)', () => {
  it('组员拖出未落页面网格(落回弹层)→ 整份快照回滚(396-399)', () => {
    const start = mkIcon(1, { id: 5, parentId: 9 })
    const current = mkIcon(2, { id: 5, parentId: null })
    const overlayOver = { id: '8', data: { current: { sortable: { containerId: 'group-9' } } } }
    expect(
      dragEndDecision(endCtx(overlayOver, {
        icons: [current],
        snapshotIcons: [start],
        draggedId: 5,
      })),
    ).toEqual([{ type: 'rollback' }])
  })

  it('组员拖出后落在无 data 的裸 droppable(如未来的删除区)→ 同样回滚(「页面网格」不含它)', () => {
    const start = mkIcon(1, { id: 5, parentId: 9 })
    const current = mkIcon(2, { id: 5, parentId: null })
    expect(
      dragEndDecision(endCtx({ id: 'trash' }, {
        icons: [current],
        snapshotIcons: [start],
        draggedId: 5,
      })),
    ).toEqual([{ type: 'rollback' }])
  })

  it('组员拖出落回页面网格 → 不回滚;弹层关闭判定 + 跨页提交同发(396/420-433)', () => {
    const start = mkIcon(1, { id: 5, parentId: 9 })
    const current = mkIcon(2, { id: 5, parentId: null })
    const iconOver = { id: '11', data: { current: { sortable: { containerId: '2' } } } }
    expect(
      dragEndDecision(endCtx(iconOver, {
        icons: [current],
        snapshotIcons: [start],
        draggedId: 5,
        openGroupId: 9,
      })),
    ).toEqual([
      { type: 'closeOverlay' },
      { type: 'commitMove', id: 5, toPageId: 2, toIndex: 0 },
    ])
  })

  it('组内重排:起终同组 → 按 over 在组内序列的绝对位序提交(403-416)', () => {
    const a = mkIcon(1, { id: 5, parentId: 9, sortOrder: 0 })
    const b = mkIcon(1, { id: 6, parentId: 9, sortOrder: 1 })
    const iconOver = { id: '6', data: { current: { sortable: { containerId: 'group-9' } } } }
    expect(
      dragEndDecision(endCtx(iconOver, {
        icons: [a, b],
        snapshotIcons: [a],
        draggedId: 5,
      })),
    ).toEqual([{ type: 'commitMove', id: 5, toPageId: 1, toIndex: 1, parentId: 9 }])
  })

  it('组内重排但 over 无效(落自己/无 over/非组内)→ 无动作(404-408)', () => {
    const a = mkIcon(1, { id: 5, parentId: 9, sortOrder: 0 })
    const b = mkIcon(1, { id: 6, parentId: 9, sortOrder: 1 })
    const iconOver = { id: '5', data: { current: { sortable: { containerId: 'group-9' } } } }
    expect(
      dragEndDecision(endCtx(iconOver, { icons: [a, b], snapshotIcons: [a], draggedId: 5 })),
    ).toEqual([])
    expect(
      dragEndDecision(endCtx(null, { icons: [a, b], snapshotIcons: [a], draggedId: 5 })),
    ).toEqual([])
    // over 是组外图标:findIndex -1 → 不提交
    const outsider = mkIcon(1, { id: 99 })
    const outsiderOver = { id: '99', data: { current: { sortable: { containerId: '1' } } } }
    expect(
      dragEndDecision(endCtx(outsiderOver, {
        icons: [a, b, outsider],
        snapshotIcons: [a],
        draggedId: 5,
      })),
    ).toEqual([])
  })
})

describe('dragEndDecision — 弹层关闭 / 跨页 / 同页提交(418-441)', () => {
  it('弹层关闭判定:确已脱离组且落页面网格才关(420-427)', () => {
    const start = mkIcon(1, { id: 5, parentId: 9 })
    const current = mkIcon(2, { id: 5, parentId: null, sortOrder: 0 })
    const pageOver = { id: '2', data: { current: { type: 'page', pageId: 2 } } }
    expect(
      dragEndDecision(endCtx(pageOver, {
        icons: [current],
        snapshotIcons: [start],
        draggedId: 5,
        openGroupId: 9,
      })),
    ).toEqual([
      { type: 'closeOverlay' },
      { type: 'commitMove', id: 5, toPageId: 2, toIndex: 0 },
    ])
  })

  it('未脱离组(startParent 仍在)不关弹层(422 行守卫)', () => {
    const start = mkIcon(1, { id: 5, parentId: 9 })
    const current = mkIcon(1, { id: 5, parentId: 9 })
    const iconOver = { id: '11', data: { current: { sortable: { containerId: '1' } } } }
    expect(
      dragEndDecision(endCtx(iconOver, {
        icons: [current],
        snapshotIcons: [start],
        draggedId: 5,
        openGroupId: 9,
      })),
    ).toEqual([])
  })

  it('跨页:缓存已是最终态,按当前 (pageId, sortOrder) 提交,不带 parentId(430-433)', () => {
    const start = mkIcon(1, { id: 5, parentId: null })
    const current = mkIcon(2, { id: 5, parentId: null, sortOrder: 3 })
    const pageOver = { id: '2', data: { current: { type: 'page', pageId: 2 } } }
    expect(
      dragEndDecision(endCtx(pageOver, {
        icons: [current],
        snapshotIcons: [start],
        draggedId: 5,
      })),
    ).toEqual([{ type: 'commitMove', id: 5, toPageId: 2, toIndex: 3 }])
  })

  it('同页:over 无效(无 over / 落自己 / 非顶层成员)→ 不提交(437-441)', () => {
    const dragged = mkIcon(1, { id: 5 })
    const other = mkIcon(1, { id: 6, sortOrder: 1 })
    const selfOver = { id: '5', data: { current: { sortable: { containerId: '1' } } } }
    expect(
      dragEndDecision(endCtx(selfOver, { icons: [dragged, other], snapshotIcons: [dragged], draggedId: 5 })),
    ).toEqual([])
    expect(
      dragEndDecision(endCtx(null, { icons: [dragged, other], snapshotIcons: [dragged], draggedId: 5 })),
    ).toEqual([])
    // over 是组内成员(不参与页面序列)→ findIndex -1 → 不提交
    const member = mkIcon(1, { id: 7, parentId: 9, sortOrder: 2 })
    const memberOver = { id: '7', data: { current: { sortable: { containerId: '1' } } } }
    expect(
      dragEndDecision(endCtx(memberOver, {
        icons: [dragged, other, member],
        snapshotIcons: [dragged],
        draggedId: 5,
      })),
    ).toEqual([])
  })

  it('自落守卫按数值比 id:图标 id 与页 droppable id 数值相撞时不发冗余自位提交(已知刻意偏差)', () => {
    // 旧实现按原始值比(5 !== '5' 落空→多发一次自位 no-op PATCH);新实现数值相等
    // 直接早退——结果等价,省一次冗余提交。钉住该偏差防止被「修复」回去。
    const dragged = mkIcon(5, { id: 5 })
    const pageOver = { id: '5', data: { current: { type: 'page', pageId: 5 } } }
    expect(
      dragEndDecision(endCtx(pageOver, { icons: [dragged], snapshotIcons: [dragged], draggedId: 5 })),
    ).toEqual([])
  })
})

// ── collisionDetection(ADR-0003 碰撞链)──────────────────────────────────

describe('collisionDetection — pointerWithin → rectIntersection → closestCorners 链', () => {
  // @dnd-kit 的 CollisionDetectionArgs 仅在测试里以最小形状构造(纯几何,无 DOM)。
  const rect = (x: number, y: number) => ({
    left: x,
    top: y,
    right: x + 10,
    bottom: y + 10,
    width: 10,
    height: 10,
  })
  const container = (id: string, x: number, y: number) => ({ id, rect: { current: rect(x, y) } })
  const mkArgs = (opts: {
    pointer: { x: number; y: number } | null
    containers: ReturnType<typeof container>[]
    draggingRect?: ReturnType<typeof rect>
  }) =>
    ({
      pointerCoordinates: opts.pointer,
      entryRect: null,
      collisionRect: opts.draggingRect ?? rect(0, 0),
      droppableRects: new Map(opts.containers.map((c) => [c.id, c.rect.current])),
      droppableContainers: opts.containers,
      activeRects: [],
      scrollableAncestors: [],
      scrollingMap: new Map(),
      offsetLeft: 0,
      offsetTop: 0,
    }) as unknown as Parameters<typeof collisionDetection>[0]

  it('指针落在边缘翻页区 → 只返回 edge(53-57,优先于其余 droppable)', () => {
    const args = mkArgs({
      pointer: { x: 5, y: 5 },
      containers: [container(EDGE_DROP_ID.left, 0, 0), container('9', 0, 0)],
    })
    expect(collisionDetection(args).map((c) => c.id)).toEqual([EDGE_DROP_ID.left])
  })

  it('指针命中普通 droppable → pointerWithin 结果短路(58 行)', () => {
    const args = mkArgs({
      pointer: { x: 15, y: 5 },
      containers: [container('a', 10, 0), container('b', 100, 100)],
    })
    expect(collisionDetection(args).map((c) => c.id)).toEqual(['a'])
  })

  it('指针为空且无矩形相交 → 回落 closestCorners(59-61)', () => {
    const args = mkArgs({
      pointer: null,
      containers: [container('far', 1000, 1000)],
      draggingRect: rect(0, 0),
    })
    expect(collisionDetection(args).length).toBeGreaterThan(0)
  })
})
