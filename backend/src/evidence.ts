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
  /** 档案字段名(pricing/limits/training_params…;值域由裁决矩阵定,票 03)。 */
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
      return {
        modelId: row.model_id,
        field: row.field,
        sourceUrl: row.source_url,
        observedAt: row.observed_at,
        excerpt: row.excerpt,
        contentFingerprint: row.content_fingerprint,
        ruleVersion: row.rule_version,
        decidedModel: row.decided_model,
        decidedAt: row.decided_at,
      }
    },
  }
}

export type Evidence = ReturnType<typeof makeEvidence>
