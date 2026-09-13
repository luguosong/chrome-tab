import { describe, expect, it } from 'vitest'
import {
  ADJUDICATION_RULE_VERSION,
  FIELD_ADJUDICATION_MATRIX,
  adjudicateField,
  type FieldObservation,
} from './adjudication'
import { openDb } from './db'
import { makeEvidence, type FieldEvidence } from './evidence'

// 纯函数全分支(issues/03):新字段/一致更新/跨信源冲突/作用域冲突/证据不足 + 矩阵已裁决
// 规则(票面点名五条 + 六类职责自然映射)+ 取代语义落库 seam。零真网零时钟:时刻全显式注入。

/** 单源观察(调用侧覆写差异项;默认 = release 页对 limits 的观察)。 */
const obs = (over: Partial<FieldObservation> = {}): FieldObservation => ({
  role: 'release',
  sourceUrl: 'https://zhipu.ai/release',
  observedAt: '2026-09-13T00:00:00Z',
  excerpt: 'GLM-5.3 发布:上下文窗口 200K',
  value: 200_000,
  ...over,
})

const base = {
  modelId: 1,
  field: 'limits',
  proposedValue: 200_000,
  observations: [obs()],
  current: null,
  decidedModel: 'coding-glm-5.3+gpt-5.5-free',
  decidedAt: '2026-09-13T00:01:00Z',
}

/** 该字段既有证据行(current.evidence 用;指纹任意合法 hex)。 */
const prevRow = (over: Partial<FieldEvidence> = {}): FieldEvidence => ({
  modelId: 1,
  field: 'limits',
  sourceUrl: 'https://zhipu.ai/docs',
  observedAt: '2026-09-01T00:00:00Z',
  excerpt: '旧值:128K',
  contentFingerprint: 'c'.repeat(64),
  ruleVersion: 'matrix-v1',
  decidedModel: 'coding-glm-5.3+gpt-5.5-free',
  decidedAt: '2026-09-01T00:01:00Z',
  ...over,
})

describe('裁决矩阵(全局单点)', () => {
  it('键集 = 证据表 field 值域;规则版本单源', () => {
    expect(Object.keys(FIELD_ADJUDICATION_MATRIX).sort()).toEqual(
      ['availability', 'limits', 'pricing', 'released_at', 'retired_at', 'stage', 'training_params'],
    )
    expect(ADJUDICATION_RULE_VERSION).toBe('matrix-v1')
  })

  it('已裁决规则落位:发布日期只认 release、价格只认 pricing、退役只认公告', () => {
    expect(FIELD_ADJUDICATION_MATRIX.released_at.roles).toEqual(['release'])
    expect(FIELD_ADJUDICATION_MATRIX.pricing.roles).toEqual(['pricing'])
    expect(FIELD_ADJUDICATION_MATRIX.retired_at.roles).toEqual(['retirement'])
    // 目录在场是 availability 的必要非充分证据:catalog 不在有权信源里,只作佐证
    expect(FIELD_ADJUDICATION_MATRIX.availability.roles).not.toContain('catalog')
    expect(FIELD_ADJUDICATION_MATRIX.availability.catalogCorroboratesApi).toBe(true)
    // 页面消失不构成退役:catalog 只能定 ga,退役向只认 retirement
    expect(FIELD_ADJUDICATION_MATRIX.stage.roleValues?.catalog).toEqual(['ga'])
    expect(FIELD_ADJUDICATION_MATRIX.stage.roleValues?.retirement).toEqual(['deprecated', 'retired'])
  })
})

describe('adjudicateField:接纳与取代', () => {
  it('新字段 → 接纳;证据行九要素齐备(指纹 64 hex、规则版本单源)', () => {
    const v = adjudicateField(base)
    expect(v).toMatchObject({ decision: 'accept' })
    if (v.decision !== 'accept') return
    expect(v.evidence).toEqual({
      modelId: 1,
      field: 'limits',
      sourceUrl: 'https://zhipu.ai/release',
      observedAt: '2026-09-13T00:00:00Z',
      excerpt: 'GLM-5.3 发布:上下文窗口 200K',
      contentFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
      ruleVersion: 'matrix-v1',
      decidedModel: 'coding-glm-5.3+gpt-5.5-free',
      decidedAt: '2026-09-13T00:01:00Z',
    })
  })

  it('多条支持观察 → 主证据取观察时间最新者', () => {
    const v = adjudicateField({
      ...base,
      observations: [
        obs({ observedAt: '2026-09-12T00:00:00Z', excerpt: '旧观察' }),
        obs({ observedAt: '2026-09-13T08:00:00Z', excerpt: '新观察', sourceUrl: 'https://zhipu.ai/docs' }),
      ],
    })
    expect(v.decision === 'accept' && v.evidence.excerpt).toBe('新观察')
  })

  it('一致更新(值同、出处更新)→ 取代:previous = 旧行,新行出处已刷新', () => {
    const old = prevRow()
    const v = adjudicateField({ ...base, current: { value: 200_000, evidence: old } })
    expect(v).toMatchObject({ decision: 'supersede', previous: old })
    if (v.decision !== 'supersede') return
    expect(v.evidence.contentFingerprint).not.toBe(old.contentFingerprint)
    expect(v.evidence.excerpt).toBe('GLM-5.3 发布:上下文窗口 200K')
  })

  it('新事实取代旧值 → 取代:旧值让位、旧行保留在 previous', () => {
    const old = prevRow()
    const v = adjudicateField({
      ...base,
      proposedValue: 400_000,
      observations: [obs({ value: 400_000, excerpt: 'GLM-5.3 上下文扩至 400K' })],
      current: { value: 200_000, evidence: old },
    })
    expect(v).toMatchObject({ decision: 'supersede', previous: old })
  })

  it('存量旧值无证行(种子首次补证)→ 取代,previous 为 null', () => {
    const v = adjudicateField({ ...base, current: { value: 128_000, evidence: null } })
    expect(v).toMatchObject({ decision: 'supersede', previous: null })
  })

  it('取代落库 seam:追加新行后 latest 取新、旧行仍在(append-only,历史可追溯)', async () => {
    const { sqlite, db } = openDb(':memory:')
    sqlite.exec(`
      INSERT INTO model_archive (provider, official_id, name, kind, stage, availability, sources, created_at, updated_at)
        VALUES ('zhipu', 'glm-5.3', 'GLM-5.3', 'text', 'ga', '["api"]', '[]', '2026-09-13T00:00:00Z', '2026-09-13T00:00:00Z');
    `)
    const evidence = makeEvidence(db)
    const old = prevRow()
    await evidence.append(old)
    const v = adjudicateField({ ...base, current: { value: 200_000, evidence: old } })
    if (v.decision !== 'supersede') throw new Error('预期 supersede')
    await evidence.append(v.evidence)
    await expect(evidence.latest(1, 'limits')).resolves.toEqual(v.evidence)
    const count = (sqlite.prepare('SELECT count(*) c FROM model_field_evidence').get() as { c: number }).c
    expect(count).toBe(2)
  })
})

describe('adjudicateField:暂缓分支', () => {
  it('字段不在矩阵 → 暂缓(无法裁决即暂缓)', () => {
    const v = adjudicateField({ ...base, field: 'summary' })
    expect(v).toMatchObject({ decision: 'defer' })
    if (v.decision !== 'defer') return
    expect(v.reason).toContain('不在裁决矩阵')
  })

  it('价格只认 pricing:release 页价格观察无权——不构成冲突也不足支撑', () => {
    const pricing = { entries: [{ text: '输入 ¥1/M tokens', scope: null }] }
    const v = adjudicateField({
      ...base,
      field: 'pricing',
      proposedValue: pricing,
      observations: [obs({ role: 'release', value: pricing, excerpt: '发布页顺带提到价格' })],
    })
    expect(v).toMatchObject({ decision: 'defer' })
    if (v.decision !== 'defer') return
    expect(v.reason).toContain('无有权信源')
  })

  it('跨信源冲突 → 暂缓:catalog 在场(ga)与 release(preview)同作用域异值', () => {
    const v = adjudicateField({
      ...base,
      field: 'stage',
      proposedValue: 'ga',
      observations: [
        obs({ role: 'catalog', value: 'ga', excerpt: '目录列出 glm-5.3' }),
        obs({ role: 'release', value: 'preview', excerpt: '发布页标注 preview' }),
      ],
    })
    expect(v).toMatchObject({ decision: 'defer' })
    if (v.decision !== 'defer') return
    expect(v.reason).toContain('跨信源冲突')
  })

  it('无权信源异值不构成冲突:pricing 提案照常裁决(release 异议被矩阵滤掉)', () => {
    const pricing = { entries: [{ text: '输入 ¥1/M tokens', scope: null }] }
    const v = adjudicateField({
      ...base,
      field: 'pricing',
      proposedValue: pricing,
      observations: [
        obs({ role: 'pricing', sourceUrl: 'https://zhipu.ai/pricing', value: pricing, excerpt: '价格页' }),
        obs({ role: 'release', value: { entries: [{ text: '输入 ¥2/M tokens', scope: null }] }, excerpt: '发布页旧价' }),
      ],
      current: null,
    })
    expect(v).toMatchObject({ decision: 'accept' })
  })

  it('作用域冲突 → 暂缓:异作用域异值不可并域(纯函数不合并作用域)', () => {
    const v = adjudicateField({
      ...base,
      field: 'training_params',
      proposedValue: '355B 总参数',
      observations: [
        obs({ role: 'release', value: '355B 总参数', excerpt: '发布宣告 355B' }),
        obs({ role: 'weights', scope: 'HF 镜像', value: '355B-A32B', excerpt: '权重页标 A32B', sourceUrl: 'https://huggingface.co/zhipu' }),
      ],
    })
    expect(v).toMatchObject({ decision: 'defer' })
    if (v.decision !== 'defer') return
    expect(v.reason).toContain('作用域冲突')
  })

  it('availability 必要性:提案含 api 但无 catalog 在场观察 → 暂缓', () => {
    const v = adjudicateField({
      ...base,
      field: 'availability',
      proposedValue: ['api'],
      observations: [obs({ role: 'release', value: ['api'], excerpt: '发布宣告 API 可用' })],
    })
    expect(v).toMatchObject({ decision: 'defer' })
    if (v.decision !== 'defer') return
    expect(v.reason).toContain('必要非充分')
  })

  it('availability 非充分:仅 catalog 在场 → 暂缓(catalog 无权确立)', () => {
    const v = adjudicateField({
      ...base,
      field: 'availability',
      proposedValue: ['api'],
      observations: [obs({ role: 'catalog', value: ['api'], excerpt: '目录列出 glm-5.3' })],
    })
    expect(v).toMatchObject({ decision: 'defer' })
    if (v.decision !== 'defer') return
    expect(v.reason).toContain('无有权信源')
  })

  it('availability 齐备:release 确立 + catalog 在场佐证 → 接纳', () => {
    const v = adjudicateField({
      ...base,
      field: 'availability',
      proposedValue: ['api'],
      observations: [
        obs({ role: 'release', value: ['api'], excerpt: '发布宣告 API 可用' }),
        obs({ role: 'catalog', value: ['api'], excerpt: '目录列出 glm-5.3' }),
      ],
    })
    expect(v).toMatchObject({ decision: 'accept' })
  })

  it('页面消失不构成退役:catalog 观察定不了退役向(超出其可裁决值域)→ 暂缓', () => {
    const v = adjudicateField({
      ...base,
      field: 'stage',
      proposedValue: 'retired',
      observations: [obs({ role: 'catalog', value: 'retired', excerpt: '目录中已无此模型' })],
    })
    expect(v).toMatchObject({ decision: 'defer' })
    if (v.decision !== 'defer') return
    expect(v.reason).toContain('可裁决值域')
  })

  it('越域观察无否决权:catalog 出目录推断 retired 拦不住合法退役公告(code-review 回归)', () => {
    const v = adjudicateField({
      ...base,
      field: 'stage',
      proposedValue: 'retired',
      observations: [
        obs({ role: 'retirement', value: 'retired', excerpt: '退役公告:官方下线' }),
        obs({ role: 'catalog', value: 'retired', excerpt: '目录中已无此模型' }),
      ],
    })
    expect(v).toMatchObject({ decision: 'accept' })
  })

  it('availability 佐证同作用域:异作用域 catalog 在场不佐证全局提案(code-review 回归)', () => {
    const v = adjudicateField({
      ...base,
      field: 'availability',
      proposedValue: ['api'],
      observations: [
        obs({ role: 'release', value: ['api'], excerpt: '发布宣告 API 可用' }),
        obs({ role: 'catalog', scope: '实验室目录', value: ['api'], excerpt: '实验室目录列出 glm-5.3' }),
      ],
    })
    expect(v).toMatchObject({ decision: 'defer' })
    if (v.decision !== 'defer') return
    expect(v.reason).toContain('必要非充分')
  })

  it('retired_at 只认退役公告:release 观察无权 → 暂缓;retirement 公告则接纳', () => {
    const off = adjudicateField({
      ...base,
      field: 'retired_at',
      proposedValue: '2026-10-01',
      observations: [obs({ role: 'release', value: '2026-10-01', excerpt: '发布页提到退役' })],
    })
    expect(off).toMatchObject({ decision: 'defer' })
    const on = adjudicateField({
      ...base,
      field: 'retired_at',
      proposedValue: '2026-10-01',
      observations: [obs({ role: 'retirement', value: '2026-10-01', excerpt: '退役公告:10-01 起下线' })],
    })
    expect(on).toMatchObject({ decision: 'accept' })
  })
})

describe('证据行构造与内容指纹', () => {
  it('齐备校验:缺原文片段/裁决模型即抛(append-only 半空行无法事后修补)', () => {
    expect(() => adjudicateField({ ...base, observations: [obs({ excerpt: '' })] })).toThrow('原文片段')
    expect(() => adjudicateField({ ...base, decidedModel: '' })).toThrow('裁决模型')
    expect(() => adjudicateField({ ...base, observations: [obs({ sourceUrl: ' ' })] })).toThrow('来源地址')
  })

  it('指纹确定性:同证据同指纹;原文变则指纹变', () => {
    const a = adjudicateField(base)
    const b = adjudicateField(base)
    const c = adjudicateField({ ...base, observations: [obs({ excerpt: '改版后:上下文 256K' })] })
    if (a.decision !== 'accept' || b.decision !== 'accept' || c.decision !== 'accept') throw new Error('预期 accept')
    expect(a.evidence.contentFingerprint).toBe(b.evidence.contentFingerprint)
    expect(a.evidence.contentFingerprint).not.toBe(c.evidence.contentFingerprint)
  })
})
