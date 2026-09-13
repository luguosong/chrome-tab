import { describe, expect, it } from 'vitest'
import { openDb } from './db'
import { makeEvidence, type FieldEvidence } from './evidence'

// 最小读写路径(issues/02):落一行、按 (模型, 字段) 读最新一行、追加取新旧行仍在。
// FK 实际生效(openDb foreign_keys=ON),先入档一行模型供 model_id 引用。

function setup() {
  const { sqlite, db } = openDb(':memory:')
  sqlite.exec(`
    INSERT INTO model_archive (provider, official_id, name, kind, stage, availability, sources, created_at, updated_at)
      VALUES ('zhipu', 'glm-5.3', 'GLM-5.3', 'text', 'ga', '["api"]', '[]', '2026-09-13T00:00:00Z', '2026-09-13T00:00:00Z');
  `)
  return { sqlite, evidence: makeEvidence(db) }
}

/** 单字段证据行(调用侧覆写差异列)。 */
const row = (over: Partial<FieldEvidence> = {}): FieldEvidence => ({
  modelId: 1,
  field: 'pricing',
  sourceUrl: 'https://zhipu.ai/pricing',
  observedAt: '2026-09-13T00:00:00Z',
  excerpt: 'GLM-5.3 输入 ¥1/M tokens',
  contentFingerprint: 'a'.repeat(64),
  ruleVersion: 'matrix-v1',
  decidedModel: 'coding-glm-5.3',
  decidedAt: '2026-09-13T00:00:01Z',
  ...over,
})

const rowCount = (sqlite: ReturnType<typeof openDb>['sqlite']) =>
  (sqlite.prepare('SELECT count(*) c FROM model_field_evidence').get() as { c: number }).c

describe('evidence:最小读写路径(append-only)', () => {
  it('落一行证据 → latest 按 (模型, 字段) 命中该行', async () => {
    const { evidence } = setup()
    await evidence.append(row())
    await expect(evidence.latest(1, 'pricing')).resolves.toEqual(row())
  })

  it('追加第二行 → 读侧自动取新,旧行仍在(取代即追加,永不抹除)', async () => {
    const { sqlite, evidence } = setup()
    await evidence.append(row({ excerpt: '旧值', contentFingerprint: 'a'.repeat(64) }))
    await evidence.append(
      row({ excerpt: '新值', contentFingerprint: 'b'.repeat(64), decidedAt: '2026-09-13T12:00:00Z' }),
    )
    await expect(evidence.latest(1, 'pricing')).resolves.toEqual(
      row({ excerpt: '新值', contentFingerprint: 'b'.repeat(64), decidedAt: '2026-09-13T12:00:00Z' }),
    )
    expect(rowCount(sqlite)).toBe(2)
  })

  it('无证据 → null;异字段/异模型互不干扰', async () => {
    const { evidence } = setup()
    await evidence.append(row())
    await expect(evidence.latest(1, 'limits')).resolves.toBeNull()
    await expect(evidence.latest(2, 'pricing')).resolves.toBeNull()
  })
})
