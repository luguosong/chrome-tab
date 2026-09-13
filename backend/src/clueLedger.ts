import type { ModelProviderId } from 'chrome-tab-shared'
import type { Db } from './db'
import type { PendingClue } from './providers/def'

/**
 * 线索账本(CONTEXT.md「线索账本」):「待核验线索」生命周期的簿记单点——入库(30 天窗 +
 * 核验后冻结 + upsert)、核验结果与未决集读侧。核验的编排(核验图、档案写入)在簿记之外
 * (verificationShadow.ts)——账本不与「模型档案」域焊接。本文件是 model_pending_clues
 * 表域行为的唯一入口;例外:bootstrapFromSeed 的 `aa:%` 一次性迁移清残(ADR-0058 存量
 * 残留)留原地,不为一次性调用 widening interface。
 *
 * 指纹重开语义(ADR-0062,issues/11 切换接管生产):同指纹守终态、指纹变化重置为未核验
 * ——取代旧链「终态不可覆盖 + 一次定终身」。终态判据以本账本为准(生产真相);旧链裁决
 * 的存量行(指纹 NULL)保守不动,存量未核验线索经 unresolvedClues 自然进入新协议首轮
 * (spec 附注:无迁移特判)。
 */

/**
 * 线索核验状态全集(读侧词表单源):DB 存储形态 pending 为 NULL、其余结果存原字面值
 * ——NULL 这个存储细节关在本模块的查询里;VerificationResultState 在结构
 * 上排除 pending,未核验只能经核验出口流转。
 */
export type ClueState = 'pending' | 'accepted' | 'rejected' | 'noise' | 'error' | 'insufficient'

/** 可记录的核验结果(pending 以 DB NULL 表示,不能作为结果回写)。 */
export type VerificationResultState = Exclude<ClueState, 'pending'>

/**
 * ingest 窗(天):挡滚动信源历史块——基线收录后该条目不再被写入,occurred_on 停更,
 * 出窗即滚出 ingest 面(收录自愈无需删行)。
 */
export const CLUE_WINDOWS = { ingestDays: 30 } as const

const nowIso = () => new Date().toISOString()

/** 日粒度 occurred_on 截断串(YYYY-MM-DD;occurred_on 是文本日期,全时间戳串比较会误排当日条目)。 */
const dayCutoff = (days: number) => new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10)

/** 行 → 域形状(未决集/重开面共用投影)。 */
const rowToClue = (row: { provider: string; occurred_on: string; title: string; source_url: string; model_key: string }): PendingClue & { provider: ModelProviderId } => ({
  provider: row.provider as ModelProviderId,
  occurredOn: row.occurred_on,
  title: row.title,
  sourceUrl: row.source_url,
  modelKey: row.model_key,
})

/**
 * 存储件工厂(先例 makeTranslationStore:无生命周期不学 service class)。
 * tests cross this seam(策略直测,票 01 裁决 8)。
 */
export function makeClueLedger(db: Pick<Db, 'selectFrom' | 'insertInto' | 'updateTable'>) {
  return {
    /**
     * 线索入库(upsert-only,2026-08-27 千问/智谱漏检回归):30 天窗内条目才入;
     * 基线收录后该条目不再被写入,occurred_on 停更,出窗即滚出入库面——收录自愈无需
     * 删行。已记录核验结果的行冻结不刷新(重复观察不续窗,线索自然淡出);滚动信源
     * (百炼)翻走前线索已入库,「漏了什么」不再不可考。
     */
    async ingest(provider: ModelProviderId, clues: PendingClue[]): Promise<void> {
      const cutoff = dayCutoff(CLUE_WINDOWS.ingestDays)
      const now = nowIso()
      const verified = new Set(
        (await db
          .selectFrom('model_pending_clues')
          .select('model_key')
          .where('provider', '=', provider)
          .where('verify_state', 'is not', null)
          .execute()
        ).map((r) => r.model_key),
      )
      for (const c of clues) {
        if (c.occurredOn < cutoff || verified.has(c.modelKey)) continue
        await db
          .insertInto('model_pending_clues')
          .values({
            provider,
            occurred_on: c.occurredOn,
            model_key: c.modelKey,
            title: c.title,
            source_url: c.sourceUrl,
            first_seen_at: now,
            last_seen_at: now,
          })
          .onConflict((oc) =>
            oc
              .columns(['provider', 'model_key'])
              .doUpdateSet({ occurred_on: c.occurredOn, title: c.title, source_url: c.sourceUrl, last_seen_at: now }),
          )
          .execute()
      }
    },

    /**
     * 未决集:全部 {pending, error} 线索(不限 occurred_on 窗,issues/11)——核验链的
     * 工作集读侧。存量未核验线索(含 35 条切换遗存)与轮询新入库线索同面自然进入;
     * error 是未终态形态,重试节奏归核验链调度(退避窗)。
     */
    async unresolvedClues(): Promise<Array<PendingClue & { provider: ModelProviderId }>> {
      const rows = await db
        .selectFrom('model_pending_clues')
        .selectAll()
        .where((eb) => eb.or([eb('verify_state', 'is', null), eb('verify_state', '=', 'error')]))
        .execute()
      return rows.map(rowToClue)
    },

    /**
     * 重开检查面:终态且按指纹裁决过(evidence_fingerprint 非空)且 occurred_on 在窗内
     * 的行——调度侧逐行重算线索专属页指纹,与裁决时落的列值比对。旧链裁决的存量终态行
     * (指纹 NULL)不在面内(保守不动);出窗后页面语境已逝,不再重开。
     */
    async reopenCandidates(days: number): Promise<Array<PendingClue & { provider: ModelProviderId; fingerprint: string }>> {
      const rows = await db
        .selectFrom('model_pending_clues')
        .selectAll()
        .where('occurred_on', '>=', dayCutoff(days))
        .where('evidence_fingerprint', 'is not', null)
        .where((eb) =>
          eb.or([eb('verify_state', '=', 'accepted'), eb('verify_state', '=', 'noise'), eb('verify_state', '=', 'insufficient')]),
        )
        .execute()
      return rows.map((r) => ({ ...rowToClue(r), fingerprint: r.evidence_fingerprint! }))
    },

    /**
     * 单行读(调度侧终态判据):返回核验状态与证据指纹;行不存在 → null。重核线索
     * (recheck: 键)不在账本,天然 null。
     */
    async clueRow(provider: ModelProviderId, modelKey: string): Promise<{ state: ClueState; fingerprint: string | null } | null> {
      const row = await db
        .selectFrom('model_pending_clues')
        .select(['verify_state', 'evidence_fingerprint'])
        .where('provider', '=', provider)
        .where('model_key', '=', modelKey)
        .executeTakeFirst()
      if (row === undefined) return null
      return { state: (row.verify_state ?? 'pending') as ClueState, fingerprint: row.evidence_fingerprint }
    },

    /**
     * 强制重开(重核通道,issues/11):无条件重置为未核验(三清)——官方资料变化重核的
     * 线索指纹(线索专属页)可能未变,等不来 reopenIfFingerprintChanged 的自然重开。
     * 行不存在是 no-op(重核键不在账本)。
     */
    async forceReopen(provider: ModelProviderId, modelKey: string): Promise<void> {
      await db
        .updateTable('model_pending_clues')
        .set({ verify_state: null, verify_reason: null, evidence_fingerprint: null })
        .where('provider', '=', provider)
        .where('model_key', '=', modelKey)
        .execute()
    },

    /**
     * 记录核验结果。仅 pending / error 可写;终态不可覆盖。reason 无则写
     * NULL——error 重试成功后清掉旧失败理由。返回值表示本次是否完成状态转移。
     * fingerprint 可选:提供即随结果落 evidence_fingerprint 列(「本状态裁决所据的
     * 证据指纹」,重开判定的比对基准);核验链出口记账恒传,缺省不触碰该列。
     */
    async recordVerification(provider: ModelProviderId, modelKey: string, state: VerificationResultState, reason?: string, fingerprint?: string): Promise<boolean> {
      const result = await db
        .updateTable('model_pending_clues')
        .set({ verify_state: state, verify_reason: reason ?? null, ...(fingerprint === undefined ? {} : { evidence_fingerprint: fingerprint }) })
        .where('provider', '=', provider)
        .where('model_key', '=', modelKey)
        .where((eb) => eb.or([eb('verify_state', 'is', null), eb('verify_state', '=', 'error')]))
        .execute()
      return result[0]!.numUpdatedRows > 0n
    },

    /**
     * 指纹重开(ADR-0062,issues/11 起接管生产):终态行且按指纹裁决过
     * (evidence_fingerprint 非空)且当前信源指纹已变 → 重置为未核验(state/reason/
     * fingerprint 三清),返回 true;同指纹守终态、指纹 NULL 的存量行(旧链裁决,未按
     * 指纹)保守不动——不因「无指纹可比」全体重开(存量集只含未核验线索,spec 附注)。
     * error 行非终态(走重试口径),不在重开面。重开后 recordVerification 即可再写。
     */
    async reopenIfFingerprintChanged(provider: ModelProviderId, modelKey: string, currentFingerprint: string): Promise<boolean> {
      const result = await db
        .updateTable('model_pending_clues')
        .set({ verify_state: null, verify_reason: null, evidence_fingerprint: null })
        .where('provider', '=', provider)
        .where('model_key', '=', modelKey)
        .where('evidence_fingerprint', 'is not', null)
        .where('evidence_fingerprint', '!=', currentFingerprint)
        .where((eb) =>
          eb.or([eb('verify_state', '=', 'accepted'), eb('verify_state', '=', 'rejected'), eb('verify_state', '=', 'noise'), eb('verify_state', '=', 'insufficient')]),
        )
        .execute()
      return result[0]!.numUpdatedRows > 0n
    },

  }
}

export type ClueLedger = ReturnType<typeof makeClueLedger>
