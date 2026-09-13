import { describe, expect, it, vi } from 'vitest'
import { openDb } from './db'
import { makeClueLedger } from './clueLedger'
import type { PendingClue } from './providers/def'

/**
 * 线索账本策略直测(票 .scratch/线索账本/01;issues/11 未决集/重开面随切换重塑):
 * 六态 × 摄入窗 × 冻结/指纹重开,全部经账本 interface(ingest/recordVerification)播种
 * ——Kysely 只作**存储真值断言**(行数/列值)。
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

describe('线索账本:未决集与重开检查面(issues/11 核验链工作集)', () => {
  const FP_A = 'a'.repeat(64)
  const FP_B = 'b'.repeat(64)
  /** 五态种子:02-03 各一条 + 一条 pending 但 occurred_on 出重开窗(01-20,ingest 窗内)。 */
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
      mk('old-window', '2026-01-20'), // >30 天重开窗,但未决集不限窗
    ])
    await ledger.recordVerification('zhipu', 'accepted', 'accepted')
    await ledger.recordVerification('zhipu', 'rejected', 'rejected', 'r')
    await ledger.recordVerification('zhipu', 'noise', 'noise')
    await ledger.recordVerification('zhipu', 'error', 'error', 'e')
    await ledger.recordVerification('zhipu', 'insufficient', 'insufficient', 'i')
    return { db, ledger, mk }
  }

  it('unresolvedClues = {pending, error} 全集不限窗(存量线索自然进入,旧终态不入)', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-05T02:41:00Z'))
    try {
      const { ledger } = await seedFiveStates()
      const unresolved = await ledger.unresolvedClues()
      // old-window(01-20,出 ingest 后所有窗)照常在未决集——35 条存量切换首轮自然消化
      expect(unresolved.map((c) => c.modelKey).sort()).toEqual(['error', 'old-window', 'pending'])
      expect(unresolved[0]).toMatchObject({ provider: 'zhipu' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('reopenCandidates = 窗内 × 指纹非空终态行:指纹 NULL 存量与出窗行不在面', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-05T02:41:00Z'))
    try {
      const { db, ledger } = await seedFiveStates()
      // 窗内按指纹终态行经 interface 播种;出窗行(occurred_on 早于 30 天 ingest 窗,
      // interface 不可表达)直写——本文件唯一 interface 外播种,判别性断言所必需
      await ledger.ingest('zhipu', [baseClue({ modelKey: 'fp-fresh', sourceUrl: 'https://docs.zhipu.com/fp-fresh', title: '新协议裁决' })])
      await ledger.recordVerification('zhipu', 'fp-fresh', 'insufficient', '证据不足', FP_A)
      await db.insertInto('model_pending_clues').values({
        provider: 'zhipu', occurred_on: '2025-12-01', model_key: 'fp-old', title: '出窗裁决',
        source_url: 'https://docs.zhipu.com/fp-old', verify_state: 'noise', verify_reason: null,
        evidence_fingerprint: FP_B, first_seen_at: '2025-12-01T00:00:00Z', last_seen_at: '2025-12-01T00:00:00Z',
      }).execute()
      const candidates = await ledger.reopenCandidates(30)
      expect(candidates.map((c) => c.modelKey)).toEqual(['fp-fresh'])
      expect(candidates[0]!.fingerprint).toBe(FP_A)
    } finally {
      vi.useRealTimers()
    }
  })

  it('clueRow 单行读:NULL 状态投影 pending,行不存在 null', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-05T02:41:00Z'))
    try {
      const { ledger } = await seedFiveStates()
      expect(await ledger.clueRow('zhipu', 'pending')).toEqual({ state: 'pending', fingerprint: null })
      expect(await ledger.clueRow('zhipu', 'insufficient')).toEqual({ state: 'insufficient', fingerprint: null })
      expect(await ledger.clueRow('zhipu', 'recheck:42')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('forceReopen 无条件重置终态(重核通道);不存在行 no-op', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-05T02:41:00Z'))
    try {
      const { db, ledger } = await seedFiveStates()
      await ledger.recordVerification('zhipu', 'pending', 'noise', undefined, FP_A)
      await ledger.forceReopen('zhipu', 'pending')
      await ledger.forceReopen('zhipu', 'recheck:42')
      const byKey = new Map((await rows(db)).map((r) => [r.model_key, r]))
      expect(byKey.get('pending')!.verify_state).toBeNull()
      expect(byKey.get('pending')!.verify_reason).toBeNull()
      expect(byKey.get('pending')!.evidence_fingerprint).toBeNull()
      // 重开后可再裁决
      expect(await ledger.recordVerification('zhipu', 'pending', 'noise')).toBe(true)
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

})
