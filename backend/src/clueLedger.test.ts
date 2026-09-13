import { describe, expect, it, vi } from 'vitest'
import { openDb } from './db'
import { makeClueLedger } from './clueLedger'
import type { PendingClue } from './providers/def'

/**
 * 线索账本策略直测(票 .scratch/线索账本/01):六态 × 摄入/活动两窗 × 冻结/重试/触人集,
 * 全部经账本 interface(ingest/recordVerification)播种——Kysely 只作**存储真值断言**(行数/
 * 列值,house style 同 modelVerify.test.ts),唯一例外是轴判别用例的单点 last_seen
 * 直写(旧轴形态经 interface 不可表达,判别性断言所必需)。
 */

const baseClue = (over: Partial<PendingClue> = {}): PendingClue => ({
  occurredOn: '2026-02-03',
  title: 'GLM-9.9 超长上下文升级',
  sourceUrl: 'https://docs.zhipu.com/glm-9-9',
  modelKey: 'https://docs.zhipu.com/glm-9-9',
  ...over,
})

async function rows(db: ReturnType<typeof openDb>['db']) {
  return db.selectFrom('model_pending_clues').selectAll().execute()
}

describe('线索账本:ingest(30 天窗 + 幂等 upsert + 完结冻结)', () => {
  it('窗内条目落库,窗外历史块被 30 天 ingest 窗挡掉', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-05T02:41:00Z'))
    try {
      const { db } = openDb(':memory:')
      const ledger = makeClueLedger(db)
      await ledger.ingest('zhipu', [
        baseClue(), // 02-03:窗内
        baseClue({ occurredOn: '2025-06-18', title: 'Vidu 历史块', modelKey: 'vidu', sourceUrl: 'https://vidu.example' }), // 窗外(滚动信源的历史块非漏检信号)
      ])
      const stored = await rows(db)
      expect(stored).toHaveLength(1)
      expect(stored[0]!.model_key).toBe(baseClue().modelKey)
    } finally {
      vi.useRealTimers()
    }
  })

  it('同键 re-ingest 幂等不翻倍,occurred_on/title 刷新、last_seen 前移', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-05T02:41:00Z'))
    try {
      const { db } = openDb(':memory:')
      const ledger = makeClueLedger(db)
      await ledger.ingest('zhipu', [baseClue({ title: 'GLM-9.9 初版' })])
      vi.setSystemTime(new Date('2026-02-06T02:41:00Z'))
      await ledger.ingest('zhipu', [baseClue({ occurredOn: '2026-02-04', title: 'GLM-9.9 修订' })])
      const stored = await rows(db)
      expect(stored).toHaveLength(1)
      expect(stored[0]!.occurred_on).toBe('2026-02-04')
      expect(stored[0]!.title).toBe('GLM-9.9 修订')
      expect(stored[0]!.last_seen_at).toBe('2026-02-06T02:41:00.000Z')
    } finally {
      vi.useRealTimers()
    }
  })

  it('已有核验结果的行冻结:error 可重试但 re-ingest 不刷新 occurred_on/title/last_seen', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-05T02:41:00Z'))
    try {
      const { db } = openDb(':memory:')
      const ledger = makeClueLedger(db)
      await ledger.ingest('zhipu', [baseClue({ title: 'GLM-9.9 初版' })])
      await ledger.recordVerification('zhipu', baseClue().modelKey, 'error', 'fixture')
      vi.setSystemTime(new Date('2026-02-07T02:41:00Z'))
      await ledger.ingest('zhipu', [baseClue({ occurredOn: '2026-02-06', title: 'GLM-9.9 修订' })])
      const stored = await rows(db)
      expect(stored).toHaveLength(1)
      expect(stored[0]!.occurred_on).toBe('2026-02-03') // 未前移
      expect(stored[0]!.title).toBe('GLM-9.9 初版')
      expect(stored[0]!.last_seen_at).toBe('2026-02-05T02:41:00.000Z') // 冻结在完结前
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('线索账本:共同活动窗两集(dueClues 重试集 / visibleClues 触人集)', () => {
  /** 五态同窗种子:02-03 各一条 + 一条 pending 但 occurred_on 出核验窗(01-20,ingest 窗内)。 */
  async function seedFiveStates() {
    const { db } = openDb(':memory:')
    const ledger = makeClueLedger(db)
    const mk = (modelKey: string, occurredOn = '2026-02-03') =>
      baseClue({ modelKey, occurredOn, sourceUrl: `https://docs.zhipu.com/${modelKey}`, title: `线索 ${modelKey}` })
    await ledger.ingest('zhipu', [
      mk('pending'),
      mk('accepted'),
      mk('rejected'),
      mk('noise'),
      mk('error'),
      mk('insufficient'),
      mk('old-window', '2026-01-20'), // >7 天核验/徽标窗、<30 天 ingest 窗
    ])
    await ledger.recordVerification('zhipu', 'accepted', 'accepted')
    await ledger.recordVerification('zhipu', 'rejected', 'rejected', 'r')
    await ledger.recordVerification('zhipu', 'noise', 'noise')
    await ledger.recordVerification('zhipu', 'error', 'error', 'e')
    await ledger.recordVerification('zhipu', 'insufficient', 'insufficient', 'i')
    return { db, ledger, mk }
  }

  it('dueClues = 核验窗(7 天)× 重试集 {pending, error}:完结三触人态与已入档态不重试,出窗 pending 不重试', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-05T02:41:00Z'))
    try {
      const { ledger } = await seedFiveStates()
      const due = await ledger.dueClues('zhipu')
      expect(due.map((c) => c.modelKey).sort()).toEqual(['error', 'pending'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('visibleClues = 徽标窗(7 天)× 触人集 {pending, rejected, insufficient}:noise/error 不触人,accepted 自然滚出,occurred_on 倒序', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-05T02:41:00Z'))
    try {
      const { ledger } = await seedFiveStates()
      // 再入一条最新线索验证倒序
      await ledger.ingest('zhipu', [baseClue({ occurredOn: '2026-02-04', modelKey: 'newest', sourceUrl: 'https://docs.zhipu.com/newest', title: '线索 newest' })])
      const visible = await ledger.visibleClues()
      const titles = visible.map((c) => c.title)
      expect(titles[0]).toBe('线索 newest') // 唯一新日期者居首
      // 其余三条同 occurred_on:原比较器对相等键返回 -1(不一致比较器,生产行为原样),
      // 并列序无保证——只断言集合
      expect(titles.slice(1).sort()).toEqual(['线索 insufficient', '线索 pending', '线索 rejected'])
      // 域形状:occurredOn 而非 wire 的 date(wire 投影归 archive())
      expect(visible[0]).toMatchObject({ provider: 'zhipu', occurredOn: '2026-02-04', title: '线索 newest', sourceUrl: 'https://docs.zhipu.com/newest' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('occurred_on 活动窗:第 7 天仍有效,第 8 天滚出核验与触达两集', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-05T02:41:00Z'))
    try {
      const { db } = openDb(':memory:')
      const ledger = makeClueLedger(db)
      await ledger.ingest('zhipu', [baseClue()]) // 02-03
      vi.setSystemTime(new Date('2026-02-10T02:41:00Z')) // 第 7 天仍在窗
      expect(await ledger.dueClues('zhipu')).toHaveLength(1)
      expect(await ledger.visibleClues()).toHaveLength(1)
      vi.setSystemTime(new Date('2026-02-11T02:41:00Z')) // 第 8 天淡出
      expect(await ledger.dueClues('zhipu')).toHaveLength(0)
      expect(await ledger.visibleClues()).toHaveLength(0)
      expect((await rows(db))).toHaveLength(1) // 行保留:滚出读侧 ≠ 删行
    } finally {
      vi.useRealTimers()
    }
  })

  it('轴判别(自 modelTracking.test.ts 迁入):完结行 occurred_on 已老、last_seen 人为保新 → 不计入徽标', async () => {
    // 生产首发痛点:35 条已完结死线索 last_seen 冻结在核验日,旧 last_seen_at 轴下 7 天内
    // 恒占「N 待核验」徽标。本用例的 last_seen 直写是全文件唯一 interface 外播种:旧轴
    // 形态(完结行 + 新鲜 last_seen)经账本 interface 不可表达——冻结规则使然,判别性
    // 断言所必需。
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-05T02:41:00Z'))
    try {
      const { db } = openDb(':memory:')
      const ledger = makeClueLedger(db)
      await ledger.ingest('zhipu', [baseClue()]) // occurred_on 02-03,窗内可见
      await ledger.recordVerification('zhipu', baseClue().modelKey, 'rejected') // 完结:reject 留表触人
      // 时间到 03-01(occurred_on 已老 26 天),但 last_seen 人为保持新鲜——旧轴判活,新轴判出
      vi.setSystemTime(new Date('2026-03-01T02:41:00Z'))
      await db
        .updateTable('model_pending_clues')
        .set({ last_seen_at: new Date().toISOString() })
        .where('model_key', '=', baseClue().modelKey)
        .execute()
      const visible = await ledger.visibleClues()
      expect(visible.some((c) => c.title.includes('GLM-9.9'))).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('线索账本:recordVerification(reason 落库与终态守卫)', () => {
  it('error 可重试转 accepted 并清除旧 reason;终态不可覆盖', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-05T02:41:00Z'))
    try {
      const { db } = openDb(':memory:')
      const ledger = makeClueLedger(db)
      await ledger.ingest('zhipu', [baseClue()])
      expect(await ledger.recordVerification('zhipu', baseClue().modelKey, 'error', '网关 502')).toBe(true)
      let stored = (await rows(db))[0]!
      expect(stored.verify_state).toBe('error')
      expect(stored.verify_reason).toBe('网关 502')
      expect(await ledger.recordVerification('zhipu', baseClue().modelKey, 'accepted')).toBe(true)
      stored = (await rows(db))[0]!
      expect(stored.verify_state).toBe('accepted')
      expect(stored.verify_reason).toBeNull()
      expect(await ledger.recordVerification('zhipu', baseClue().modelKey, 'rejected', '迟到改判')).toBe(false)
      stored = (await rows(db))[0]!
      expect(stored.verify_state).toBe('accepted')
      expect(stored.verify_reason).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('线索账本:指纹重开(issues/05;影子期经接口交付,旧链调用形态零变化)', () => {
  const FP_A = 'a'.repeat(64)
  const FP_B = 'b'.repeat(64)

  it('recordVerification 传 fingerprint 落列;不传不动列(旧链零变化)', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-05T02:41:00Z'))
    try {
      const { db } = openDb(':memory:')
      const ledger = makeClueLedger(db)
      await ledger.ingest('zhipu', [baseClue({ modelKey: 'with-fp' }), baseClue({ modelKey: 'no-fp' })])
      await ledger.recordVerification('zhipu', 'with-fp', 'noise', undefined, FP_A)
      await ledger.recordVerification('zhipu', 'no-fp', 'noise')
      const byKey = new Map((await rows(db)).map((r) => [r.model_key, r]))
      expect(byKey.get('with-fp')!.evidence_fingerprint).toBe(FP_A)
      expect(byKey.get('no-fp')!.evidence_fingerprint).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('同指纹守终态(reopen 返回 false 状态不变);指纹变化重置为未核验且可再裁决', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-05T02:41:00Z'))
    try {
      const { db } = openDb(':memory:')
      const ledger = makeClueLedger(db)
      await ledger.ingest('zhipu', [baseClue()])
      await ledger.recordVerification('zhipu', baseClue().modelKey, 'insufficient', '证据不足', FP_A)
      // 同指纹:终态守住
      expect(await ledger.reopenIfFingerprintChanged('zhipu', baseClue().modelKey, FP_A)).toBe(false)
      let stored = (await rows(db))[0]!
      expect(stored.verify_state).toBe('insufficient')
      // 指纹变化:重置为未核验(三清)
      expect(await ledger.reopenIfFingerprintChanged('zhipu', baseClue().modelKey, FP_B)).toBe(true)
      stored = (await rows(db))[0]!
      expect(stored.verify_state).toBeNull()
      expect(stored.verify_reason).toBeNull()
      expect(stored.evidence_fingerprint).toBeNull()
      // 重开后可再裁决(新结果带新指纹)
      expect(await ledger.recordVerification('zhipu', baseClue().modelKey, 'rejected', '复核改判', FP_B)).toBe(true)
      stored = (await rows(db))[0]!
      expect(stored.verify_state).toBe('rejected')
      expect(stored.evidence_fingerprint).toBe(FP_B)
    } finally {
      vi.useRealTimers()
    }
  })

  it('指纹 NULL 的存量终态行保守不动(未按指纹裁决,不因无可比对全体重开);error 行不在重开面', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-05T02:41:00Z'))
    try {
      const { db } = openDb(':memory:')
      const ledger = makeClueLedger(db)
      await ledger.ingest('zhipu', [baseClue({ modelKey: 'legacy' }), baseClue({ modelKey: 'err' })])
      await ledger.recordVerification('zhipu', 'legacy', 'rejected', '旧链裁决')
      await ledger.recordVerification('zhipu', 'err', 'error', 'e')
      expect(await ledger.reopenIfFingerprintChanged('zhipu', 'legacy', FP_B)).toBe(false)
      expect(await ledger.reopenIfFingerprintChanged('zhipu', 'err', FP_B)).toBe(false)
      const byKey = new Map((await rows(db)).map((r) => [r.model_key, r]))
      expect(byKey.get('legacy')!.verify_state).toBe('rejected')
      expect(byKey.get('err')!.verify_state).toBe('error')
    } finally {
      vi.useRealTimers()
    }
  })

  it('cluesFirstSeenSince:first_seen_at 轴、任意状态、带 provider', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-05T02:41:00Z'))
    try {
      const { db } = openDb(':memory:')
      const ledger = makeClueLedger(db)
      await ledger.ingest('zhipu', [baseClue({ modelKey: 'fresh', sourceUrl: 'https://docs.zhipu.com/fresh', title: '新线索' })])
      await ledger.recordVerification('zhipu', 'fresh', 'rejected', 'r') // 已裁决也摄入(旧链同轮即核验)
      vi.setSystemTime(new Date('2026-02-06T02:41:00Z'))
      await ledger.ingest('zhipu', [baseClue({ modelKey: 'newer', occurredOn: '2026-02-06', sourceUrl: 'https://docs.zhipu.com/newer', title: '更新线索' })])
      const since = new Date('2026-02-05T12:00:00Z').toISOString()
      const got = await ledger.cluesFirstSeenSince(since)
      expect(got.map((c) => c.modelKey)).toEqual(['newer'])
      expect(got[0]).toMatchObject({ provider: 'zhipu', title: '更新线索' })
    } finally {
      vi.useRealTimers()
    }
  })
})
