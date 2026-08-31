import { describe, expect, it } from 'vitest'
import { createHoverGrace, type GraceBox } from './hoverGrace'

// 悬浮宽限(CONTEXT.md「悬浮宽限」):Clock 弹层与待办快览卡两宿主共用的
// hover 手势状态机。节奏常量 250/150 与门槛 10 是行为规格的独立事实源,
// 断言值全部来自旧实现(Clock.tsx / TodoIcon.tsx 收编前)的既定行为。

/** 手动时钟:注入状态机的 timer,拨针推进触发到期任务。 */
function manualClock() {
  type Job = { at: number; fn: () => void; id: number }
  let now = 0
  let seq = 0
  const jobs: Job[] = []
  return {
    timer: {
      set(fn: () => void, ms: number) {
        const j: Job = { at: now + ms, fn, id: ++seq }
        jobs.push(j)
        return j.id
      },
      clear(h: unknown) {
        const i = jobs.findIndex((j) => j.id === h)
        if (i !== -1) jobs.splice(i, 1)
      },
    },
    /** 拨针:按到期时刻序执行所有到点任务(执行中新排且到点的也执行)。 */
    advance(ms: number) {
      const target = now + ms
      for (;;) {
        const due = jobs.filter((j) => j.at <= target).sort((a, b) => a.at - b.at)[0]
        if (!due) break
        now = due.at
        jobs.splice(jobs.indexOf(due), 1)
        due.fn()
      }
      now = target
    },
  }
}

/** 盒字面量(状态机只读四边;DOMRect 结构兼容)。 */
const box = (x: number, y: number, w: number, h: number): GraceBox => ({
  left: x,
  top: y,
  right: x + w,
  bottom: y + h,
})

/** 触发盒(0,0,100,20)与浮层盒(x=108)间留 8px 间隙——两宿主现状同款,宽限期几何判定的意义所在。 */
const TRIGGER = box(0, 0, 100, 20)
const FLOATING = box(108, 0, 200, 100)

type Payload = { tag: string }

function setup(gatePx = 0) {
  const clock = manualClock()
  const shown: Payload[] = []
  let hides = 0
  let floating: GraceBox | null = null
  const grace = createHoverGrace<Payload>({
    onShow: (p) => shown.push(p),
    onHide: () => {
      hides += 1
    },
    getFloatingRect: () => floating,
    moveGatePx: gatePx,
    timer: clock.timer,
  })
  return {
    grace,
    clock,
    shown,
    /** 收起次数(函数引用,避免解构 getter 拿到过期快照)。 */
    hides: () => hides,
    /** 浮层已挂载(判定盒开始可见)。 */
    mountFloating() {
      floating = FLOATING
    },
  }
}

describe('hoverGrace', () => {
  it('首次交互门槛:累计位移不足不显示,足了才显示(防刷新后静置指针幽灵触发)', () => {
    const { grace, shown } = setup(10)
    grace.pointerMove(0, 0) // 首帧只记基准,不累计
    grace.pointerMove(4, 0) // 累计 4 < 10
    grace.enter({ tag: 'a' })
    expect(shown).toEqual([])
    grace.pointerMove(10, 3) // 累计 4 + 9 = 13 ≥ 10
    grace.enter({ tag: 'a' })
    expect(shown).toEqual([{ tag: 'a' }])
  })

  it('无门槛(gate=0)恒显示:时钟弹层从未需要门槛', () => {
    const { grace, shown } = setup()
    grace.enter({ tag: 'a' })
    expect(shown).toEqual([{ tag: 'a' }])
  })

  it('宽限到期收起:leave 后 249ms 不收,250ms 到点即收且恰一次(浮层未挂载=区外)', () => {
    const { grace, clock, hides } = setup()
    grace.enter({ tag: 'a' })
    grace.leave(TRIGGER)
    clock.advance(249)
    expect(hides()).toBe(0)
    clock.advance(1)
    expect(hides()).toBe(1)
  })

  it('几何续期:指针停在触发盒与浮层盒的间隙(联合外接内)持续重拍不收,移出后下一拍即收', () => {
    const { grace, clock, hides, mountFloating } = setup()
    grace.enter({ tag: 'a' })
    mountFloating()
    grace.pointerMove(104, 10) // 间隙 x∈(100,108):慢速穿越途中,正是宽限存在的理由
    grace.leave(TRIGGER)
    clock.advance(250 + 150 * 3) // 宽限 + 三轮重拍,指针一直在区内
    expect(hides()).toBe(0)
    grace.pointerMove(104, 200) // 出联合矩形(浮层底 100 之外)
    clock.advance(150)
    expect(hides()).toBe(1)
  })

  it('stay 取消收起:浮层自身 mouseenter 清宽限计时,再久也不收', () => {
    const { grace, clock, hides, mountFloating } = setup()
    grace.enter({ tag: 'a' })
    mountFloating()
    grace.leave(TRIGGER)
    clock.advance(100)
    grace.stay() // 指针滑入浮层(portal 挂载时浮层不在触发元素子树,事件自持)
    clock.advance(1000)
    expect(hides()).toBe(0)
  })

  it('close 即时收起且清计时:快览卡三暗坑(数据变/切页/滚动)与点行的统一收口', () => {
    const { grace, clock, hides } = setup()
    grace.enter({ tag: 'a' })
    grace.leave(TRIGGER)
    grace.close()
    expect(hides()).toBe(1)
    clock.advance(1000) // 旧宽限计时已清,不重复收
    expect(hides()).toBe(1)
    grace.close() // 已收起再 close 无害(visible 门幂等)
    expect(hides()).toBe(1)
  })

  it('重复 leave 不叠计时:行与浮层两路 leave 交错,收起仍恰一次', () => {
    const { grace, clock, hides } = setup()
    grace.enter({ tag: 'a' })
    grace.leave(TRIGGER)
    grace.leave(TRIGGER) // 浮层侧 leave 同参数再入
    clock.advance(1000)
    expect(hides()).toBe(1)
  })

  it('dispose 只清计时不触发收起:卸载后不再回调', () => {
    const { grace, clock, hides } = setup()
    grace.enter({ tag: 'a' })
    grace.leave(TRIGGER)
    grace.dispose()
    clock.advance(1000)
    expect(hides()).toBe(0)
  })

  it('enter 清待收计时:宽限窗内重进触发区,旧宽限作废不再收(旧 enterPanel 先清计时的等价迁移)', () => {
    const { grace, clock, hides } = setup()
    grace.enter({ tag: 'a' })
    grace.leave(TRIGGER)
    grace.enter({ tag: 'b' }) // 指针抖回触发区:重显(快照更新),旧宽限作废
    clock.advance(1000)
    expect(hides()).toBe(0)
  })
})
