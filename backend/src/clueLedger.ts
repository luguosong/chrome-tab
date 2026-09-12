import type { ModelProviderId } from 'chrome-tab-shared'
import type { Db } from './db'
import type { PendingClue } from './providers/def'

/**
 * 线索账本(CONTEXT.md「线索账本」;票 .scratch/线索账本/01):「待核验线索」生命周期的
 * 簿记单点——入库(30 天窗 + 完结冻结 + upsert)、结案(五态 + reason 落库/清残)与两窗
 * 可见性(核验窗 = 重试集 {pending, error},徽标窗 = 触人集 {pending, rejected,
 * insufficient};同 occurred_on 轴、各自窗口宽度)。自动核验的编排(LLM 判别、accept 的
 * 档案写入)在簿记之外(modelTracking.ts 的 verifyPendingClues)——账本不与「模型档案」域
 * 焊接。本文件是 model_pending_clues 表域行为的唯一入口;例外:bootstrapFromSeed 的
 * `aa:%` 一次性迁移清残(ADR-0058 存量残留)留原地,不为一次性调用 widening interface。
 */

/**
 * 线索核验状态全集(读侧词表单源):DB 存储形态 pending 为 NULL、完结五态存原字面值
 * ——NULL 这个存储细节关在本模块的查询里;settle 的入参类型 SettledClueState 在结构
 * 上排除 pending,未核验只能经核验出口流转。
 */
export type ClueState = 'pending' | 'accepted' | 'rejected' | 'noise' | 'error' | 'insufficient'

/** 结案可写的态(settle 不能写 pending——未核验只能经核验出口流转)。 */
export type SettledClueState = Exclude<ClueState, 'pending'>

/** visibleClues 的域形状(occurred_on 轴);wire 投影({date, url})归 archive()。 */
export interface VisibleClue {
  provider: ModelProviderId
  occurredOn: string
  title: string
  sourceUrl: string
}

/**
 * 三窗共点声明(天):ingest 窗挡滚动信源历史块;核验窗(auto 重试)与徽标窗(触人)同
 * occurred_on 轴(ADR-0058 注记 2026-09-10:读侧计数的窗口须与其处理队列窗口同轴,冻结
 * 行在计数轴上「假新鲜」)但语义异集,故各留字段——两值同为 7 天是现状而非锁定约束
 * (徽标将来放宽不该被结构挡住)。
 */
export const CLUE_WINDOWS = { ingestDays: 30, verifyDays: 7, badgeDays: 7 } as const

const nowIso = () => new Date().toISOString()

/** 日粒度 occurred_on 截断串(YYYY-MM-DD;occurred_on 是文本日期,全时间戳串比较会误排当日条目)。 */
const dayCutoff = (days: number) => new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10)

/**
 * 存储件工厂(先例 makeTranslationStore:无生命周期不学 service class)。
 * interface = 四方法;tests cross this seam(策略直测,票 01 裁决 8)。
 */
export function makeClueLedger(db: Db) {
  return {
    /**
     * 线索入库(upsert-only,2026-08-27 千问/智谱漏检回归):30 天窗内条目才入;
     * 基线收录后该条目不再被写入,occurred_on 停更,读侧 7 天窗出窗即滚出——收录自愈
     * 无需删行。滚动信源(百炼)翻走前线索已可见,「漏了什么」不再不可考。
     * 已核验的行冻结不刷新(生产首发教训:常态噪音 reject 后仍被刷新 last_seen,7 天窗内
     * 恒占「N 待核验」徽标)——完结线索不再滚窗,自然淡出。
     */
    async ingest(provider: ModelProviderId, clues: PendingClue[]): Promise<void> {
      const cutoff = dayCutoff(CLUE_WINDOWS.ingestDays)
      const now = nowIso()
      const done = new Set(
        (await db
          .selectFrom('model_pending_clues')
          .select('model_key')
          .where('provider', '=', provider)
          .where('verify_state', 'is not', null)
          .execute()
        ).map((r) => r.model_key),
      )
      for (const c of clues) {
        if (c.occurredOn < cutoff || done.has(c.modelKey)) continue
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
     * 核验窗(7 天)× 重试集 {pending, error}:auto 核验一轮的输入(ADR-0058)。error
     * 落表可观测且下轮重试(spec 1.2);rejected / insufficient 不重试(前者已触人,
     * 后者一次定终身——信源 7 天窗内更新概率低,重试 = 每轮烧强模型看同一页)。
     */
    async dueClues(provider: ModelProviderId): Promise<PendingClue[]> {
      const cutoff = dayCutoff(CLUE_WINDOWS.verifyDays)
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
     * 徽标窗(7 天)× 触人集 {pending, rejected, insufficient},occurred_on 倒序:「N 待核验」
     * 徽标与 Modal 待核验列表的共同读侧。noise(确定性噪音)与 error(核验链失败,轮询自愈)
     * 不触人不占徽标;accepted 自然滚出。与核验窗同 occurred_on 轴(ADR-0058 注记
     * 2026-09-10 轴对齐:已完结线索 ingest 冻结后 occurred_on 不再前移,按事件日期滚出,
     * 不恒占徽标淹没真增量)。域形状(occurredOn);wire 投影({date})归 archive()。
     */
    async visibleClues(): Promise<VisibleClue[]> {
      const cutoff = dayCutoff(CLUE_WINDOWS.badgeDays)
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
     * 结案落库(accepted / rejected / noise / error / insufficient)。reason 无则写
     * NULL——状态转移时顺带清残(error 重试后 accept,旧失败理由不残留误导归因)。
     */
    async settle(provider: ModelProviderId, modelKey: string, state: SettledClueState, reason?: string): Promise<void> {
      await db
        .updateTable('model_pending_clues')
        .set({ verify_state: state, verify_reason: reason ?? null })
        .where('provider', '=', provider)
        .where('model_key', '=', modelKey)
        .execute()
    },
  }
}

export type ClueLedger = ReturnType<typeof makeClueLedger>
