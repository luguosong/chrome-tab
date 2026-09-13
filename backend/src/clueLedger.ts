import type { ModelProviderId } from 'chrome-tab-shared'
import type { Db } from './db'
import type { PendingClue } from './providers/def'

/**
 * 线索账本(CONTEXT.md「线索账本」;票 .scratch/线索账本/01):「待核验线索」生命周期的
 * 簿记单点——入库(30 天窗 + 核验后冻结 + upsert)、核验结果与活动窗
 * 可见性(核验集 = {pending, error},触人集 = {pending, rejected,
 * insufficient};共用 occurred_on 轴)。自动核验的编排(LLM 判别、accept 的
 * 档案写入)在簿记之外(modelTracking.ts 的 verifyPendingClues)——账本不与「模型档案」域
 * 焊接。本文件是 model_pending_clues 表域行为的唯一入口;例外:bootstrapFromSeed 的
 * `aa:%` 一次性迁移清残(ADR-0058 存量残留)留原地,不为一次性调用 widening interface。
 *
 * 指纹重开语义(ADR-0062,issues/05):同指纹守终态、指纹变化重置为未核验——取代旧链
 * 「终态不可覆盖 + 一次定终身」。影子期(issues/05)生产流不写账本(新链走私有注册表),
 * 本语义经接口交付、切换(issues/11)后接管生产;旧链调用形态(不传指纹)行为零变化。
 */

/**
 * 线索核验状态全集(读侧词表单源):DB 存储形态 pending 为 NULL、其余结果存原字面值
 * ——NULL 这个存储细节关在本模块的查询里;VerificationResultState 在结构
 * 上排除 pending,未核验只能经核验出口流转。
 */
export type ClueState = 'pending' | 'accepted' | 'rejected' | 'noise' | 'error' | 'insufficient'

/** 可记录的核验结果(pending 以 DB NULL 表示,不能作为结果回写)。 */
export type VerificationResultState = Exclude<ClueState, 'pending'>

/** visibleClues 的域形状(occurred_on 轴);wire 投影({date, url})归 archive()。 */
export interface VisibleClue {
  provider: ModelProviderId
  occurredOn: string
  title: string
  sourceUrl: string
}

/**
 * 两窗共点声明(天):ingest 窗挡滚动信源历史块;核验与触达共用
 * activeDays 与 occurred_on 轴(ADR-0058 注记 2026-09-10),防止冻结行在计数轴上「假新鲜」。
 */
export const CLUE_WINDOWS = { ingestDays: 30, activeDays: 7 } as const

const nowIso = () => new Date().toISOString()

/** 日粒度 occurred_on 截断串(YYYY-MM-DD;occurred_on 是文本日期,全时间戳串比较会误排当日条目)。 */
const dayCutoff = (days: number) => new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10)

/**
 * 存储件工厂(先例 makeTranslationStore:无生命周期不学 service class)。
 * interface = 四方法;tests cross this seam(策略直测,票 01 裁决 8)。
 */
export function makeClueLedger(db: Pick<Db, 'selectFrom' | 'insertInto' | 'updateTable'>) {
  return {
    /**
     * 线索入库(upsert-only,2026-08-27 千问/智谱漏检回归):30 天窗内条目才入;
     * 基线收录后该条目不再被写入,occurred_on 停更,读侧 7 天窗出窗即滚出——收录自愈
     * 无需删行。滚动信源(百炼)翻走前线索已可见,「漏了什么」不再不可考。
     * 已记录核验结果的行冻结不刷新(生产首发教训:常态噪音 reject 后仍被刷新 last_seen,7 天窗内
     * 恒占「N 待核验」徽标)——重复观察不续窗,线索自然淡出。
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
     * 活动窗(7 天)× 重试集 {pending, error}:auto 核验一轮的输入(ADR-0058)。error
     * 落表可观测且下轮重试(spec 1.2);rejected / insufficient 不重试(前者已触人,
     * 后者一次定终身——信源 7 天窗内更新概率低,重试 = 每轮烧强模型看同一页)。
     */
    async dueClues(provider: ModelProviderId): Promise<PendingClue[]> {
      const cutoff = dayCutoff(CLUE_WINDOWS.activeDays)
      const pending = await db
        .selectFrom('model_pending_clues')
        .selectAll()
        .where('provider', '=', provider)
        .where('occurred_on', '>=', cutoff)
        .where((eb) => eb.or([eb('verify_state', 'is', null), eb('verify_state', '=', 'error')]))
        .execute()
      return pending.map((row) => ({
        occurredOn: row.occurred_on,
        title: row.title,
        sourceUrl: row.source_url,
        modelKey: row.model_key,
      }))
    },

    /**
     * 活动窗(7 天)× 触人集 {pending, rejected, insufficient},occurred_on 倒序:「N 待核验」
     * 徽标与 Modal 待核验列表的共同读侧。noise(确定性噪音)与 error(核验链失败,轮询自愈)
     * 不触人不占徽标;accepted 自然滚出。与核验窗同 occurred_on 轴(ADR-0058 注记
     * 2026-09-10 轴对齐:已完结线索 ingest 冻结后 occurred_on 不再前移,按事件日期滚出,
     * 不恒占徽标淹没真增量)。域形状(occurredOn);wire 投影({date})归 archive()。
     */
    async visibleClues(): Promise<VisibleClue[]> {
      const cutoff = dayCutoff(CLUE_WINDOWS.activeDays)
      const clueRows = await db
        .selectFrom('model_pending_clues')
        .selectAll()
        .where('occurred_on', '>=', cutoff)
        .where((eb) => eb.or([eb('verify_state', 'is', null), eb('verify_state', '=', 'rejected'), eb('verify_state', '=', 'insufficient')]))
        .execute()
      return clueRows
        .sort((a, b) => (a.occurred_on < b.occurred_on ? 1 : -1))
        .map((r) => ({
          provider: r.provider as ModelProviderId,
          occurredOn: r.occurred_on,
          title: r.title,
          sourceUrl: r.source_url,
        }))
    },

    /**
     * 记录核验结果。仅 pending / error 可写;终态不可覆盖。reason 无则写
     * NULL——error 重试成功后清掉旧失败理由。返回值表示本次是否完成状态转移。
     * fingerprint(issues/05 指纹重开)可选:提供即随结果落 evidence_fingerprint 列
     * (「本状态裁决所据的证据指纹」,reopenIfFingerprintChanged 的比对基准);缺省不触碰
     * 该列——旧链调用形态行为零变化。
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
     * 指纹重开(issues/05;影子期经接口交付、切换后接管生产):终态行且按指纹裁决过
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

    /**
     * first_seen_at 轴全量读(影子链摄取面,issues/05):自影子链启动时刻起新见的线索
     * (任意状态——旧链在同一轮 poll 内即完成核验,按状态摄取会系统性漏空,真流量摄取
     * 只能按「何时首见」划界)。与 dueClues(旧链重试面)分立,互不改写语义。
     */
    async cluesFirstSeenSince(sinceIso: string): Promise<Array<PendingClue & { provider: ModelProviderId }>> {
      const rows = await db
        .selectFrom('model_pending_clues')
        .selectAll()
        .where('first_seen_at', '>=', sinceIso)
        .execute()
      return rows.map((row) => ({
        provider: row.provider as ModelProviderId,
        occurredOn: row.occurred_on,
        title: row.title,
        sourceUrl: row.source_url,
        modelKey: row.model_key,
      }))
    },
  }
}

export type ClueLedger = ReturnType<typeof makeClueLedger>
