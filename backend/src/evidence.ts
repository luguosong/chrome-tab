import type { ModelProviderId } from 'chrome-tab-shared'
import type { Db } from './db'

/**
 * 事实证据存储件(CONTEXT.md「事实证据」;ADR-0062 决策三,issues/02):model_field_evidence
 * 表域行为的唯一入口。append-only——取代即追加、旧行永不抹除,本模块不提供任何
 * UPDATE/DELETE 方法;字段当前值 = 该字段最新一行。证据行构造(裁决元数据从何而来)
 * 归裁决矩阵消费侧(票 03),此处只管存取。存储件工厂(先例 makeClueLedger:无生命
 * 周期不学 service class)。
 */

/** 一行字段级证据(append 的入参;latest 的返回形状)。 */
export interface FieldEvidence {
  modelId: number
  /** 档案字段名(pricing/limits/training_params…;值域单源 = adjudication.ts 的矩阵键集)。 */
  field: string
  sourceUrl: string
  /** 一手信源观察时间(≠ 裁决时刻,取证与裁决分属调查/复核两段)。 */
  observedAt: string
  excerpt: string
  /** 证据内容 SHA-256(相同证据不重复核验)。 */
  contentFingerprint: string
  ruleVersion: string
  decidedModel: string
  decidedAt: string
}

/** 行 → 域形状(latest/listByProvider 共用投影;结构化行类型 = select 结果两形态共用)。 */
const toEvidence = (row: {
  model_id: number
  field: string
  source_url: string
  observed_at: string
  excerpt: string
  content_fingerprint: string
  rule_version: string
  decided_model: string
  decided_at: string
}): FieldEvidence => ({
  modelId: row.model_id,
  field: row.field,
  sourceUrl: row.source_url,
  observedAt: row.observed_at,
  excerpt: row.excerpt,
  contentFingerprint: row.content_fingerprint,
  ruleVersion: row.rule_version,
  decidedModel: row.decided_model,
  decidedAt: row.decided_at,
})

export function makeEvidence(db: Pick<Db, 'insertInto' | 'selectFrom'>) {
  return {
    /** 追加一行证据(append-only:取代即追加,旧行永不抹除)。 */
    async append(e: FieldEvidence): Promise<void> {
      await db
        .insertInto('model_field_evidence')
        .values({
          model_id: e.modelId,
          field: e.field,
          source_url: e.sourceUrl,
          observed_at: e.observedAt,
          excerpt: e.excerpt,
          content_fingerprint: e.contentFingerprint,
          rule_version: e.ruleVersion,
          decided_model: e.decidedModel,
          decided_at: e.decidedAt,
        })
        .execute()
    },

    /**
     * 同证据已在库(按内容指纹;同证据重放 observedAt 不变 → 指纹不变,票 04 幂等契约)。
     * commit 执行器重核路径重放时的去重守卫——append-only 无 UPDATE/DELETE,「重复」
     * 只能不追加以避免(issues/11:重核线索不在账本,事务级状态守卫护不到证据行)。
     */
    async has(modelId: number, field: string, contentFingerprint: string): Promise<boolean> {
      const row = await db
        .selectFrom('model_field_evidence')
        .select('id')
        .where('model_id', '=', modelId)
        .where('field', '=', field)
        .where('content_fingerprint', '=', contentFingerprint)
        .executeTakeFirst()
      return row !== undefined
    },

    /**
     * 字段当前值投影 = (模型, 字段) 最新一行(append-only 下 id 单调 = 落行序);
     * 无证据返回 null。
     */
    async latest(modelId: number, field: string): Promise<FieldEvidence | null> {
      const row = await db
        .selectFrom('model_field_evidence')
        .selectAll()
        .where('model_id', '=', modelId)
        .where('field', '=', field)
        .orderBy('id', 'desc')
        .limit(1)
        .executeTakeFirst()
      if (!row) return null
      return toEvidence(row)
    },

    /**
     * 该家全部证据行(核验图调查上下文白名单第三件,issues/05 生产装配):按 model_archive
     * 归属 join 到 provider,升序返回(消费侧自取各 (模型,字段) 最新行)。
     */
    async listByProvider(provider: ModelProviderId): Promise<FieldEvidence[]> {
      const rows = await db
        .selectFrom('model_field_evidence')
        .innerJoin('model_archive', (join) => join.onRef('model_field_evidence.model_id', '=', 'model_archive.id'))
        .selectAll('model_field_evidence')
        .where('model_archive.provider', '=', provider)
        .orderBy('model_field_evidence.id', 'asc')
        .execute()
      return rows.map(toEvidence)
    },
  }
}

export type Evidence = ReturnType<typeof makeEvidence>
