import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type { FieldEvidence } from './evidence'

/**
 * 字段裁决矩阵与裁决纯函数(CONTEXT.md「事实证据」「无人值守数据核验」;ADR-0062 决策二/三,
 * issues/03):核验域的「尺子」。全局单点的 字段 → 有权信源类 映射,与「提案 × 多源证据 →
 * 字段级裁决」纯函数。零 IO:裁决只产出判定与待追加的证据行,落库归核验图的图内最终事务节点
 * (票 04);append-only 由 evidence.ts 的 API 面实现,本模块永不产出「改/删」。
 *
 * 证据语义硬规(ADR-0062):观察只有正向事实——资料消失/页面消失不是观察,类型上即无法表达
 * (FieldObservation 无 absent 变体),永不构成相反事实;只有新的明确事实可以取代旧值(取代 =
 * 追加新行,旧行永不抹除);无法裁决即暂缓。首次观察时间不冒充发布日期(observedAt 与
 * released_at 分属两字段,发布日期只认 release 信源的明确标注)。
 */

/** 信源角色六类(值域事实源 = ADR-0062 决策二)。值域单源在此,票 06 信源注册表 import。 */
export type SourceRole = 'release' | 'catalog' | 'pricing' | 'limits' | 'weights' | 'retirement'

/** 一条字段裁决规则(矩阵行)。 */
export interface FieldRule {
  /** 有权信源类:仅这些角色的观察可定该字段;其余信源的观察不构成冲突也不足支撑(如价格只认 pricing)。 */
  readonly roles: readonly SourceRole[]
  /**
   * availability 特例(ADR-0062 决策二):目录在场是必要非充分证据——提案值含 'api' 时必须
   * 另有 catalog 在场观察佐证;catalog 不在 roles 里,单独永不足以确立。
   */
  readonly catalogCorroboratesApi?: boolean
  /**
   * 角色 → 可裁决值子集;缺省 = 不限。stage 用:catalog 在场只构成 ga,退役向只认 retirement
   * (页面消失不构成退役——catalog 出目录不是观察,也不能定 deprecated/retired)。
   */
  readonly roleValues?: Partial<Record<SourceRole, readonly string[]>>
}

/**
 * 全局字段裁决矩阵(单点;ADR-0062 决策二「字段冲突按全局裁决矩阵处理」,裁决不随厂家复制)。
 * 键集 = 证据表 field 值域(evidence.ts 单源指针);未列字段(kind/name/summary…)一律暂缓
 * ——无法裁决即暂缓,影子期(票 10)按实测缺口再扩。
 */
export const FIELD_ADJUDICATION_MATRIX = {
  /** 发布日期只认 release;首次观察时间不冒充发布日期(CONTEXT「事实证据」)。 */
  released_at: { roles: ['release'] },
  /** 价格只认 pricing。 */
  pricing: { roles: ['pricing'] },
  /** 限额(上下文窗口/速率等):限额信源为主,发布宣告常载明上下文窗口(补证主路径)。 */
  limits: { roles: ['limits', 'release'] },
  /** 训练参数量:发布宣告或权重页披露。 */
  training_params: { roles: ['release', 'weights'] },
  availability: { roles: ['release', 'weights'], catalogCorroboratesApi: true },
  stage: {
    roles: ['release', 'catalog', 'retirement'],
    roleValues: {
      // 进入官方 API 目录即 GA 语义(spec 用户故事 5);在场是观察,出目录不是
      catalog: ['ga'],
      retirement: ['deprecated', 'retired'],
    },
  },
  /** 退役日期只认退役公告。 */
  retired_at: { roles: ['retirement'] },
} as const satisfies Record<string, FieldRule>

/** 裁决规则版本(证据行 rule_version 单源;矩阵语义变更时递增)。 */
export const ADJUDICATION_RULE_VERSION = 'matrix-v1'

/** 单源单字段观察(调查节点取证的最小单元;来源 = 该厂家注册信源,票 06)。 */
export interface FieldObservation {
  role: SourceRole
  sourceUrl: string
  /** 一手信源观察时间(≠ 裁决时刻,取证与裁决分属调查/复核两段)。 */
  observedAt: string
  /** 支撑该值的原文片段(回链证据)。 */
  excerpt: string
  /** 观察到的字段值(与提案值同构深比较;档案列形态或事件锚定值)。 */
  value: unknown
  /** 作用域(地域/系列归属,厂家 def 的 scope 提取;缺省全局)。生效日期未开观察级独立维度
   *  (ADR-0062 未列)——pricing 等字段的 effectiveFrom 随字段值形态参与深比较。 */
  scope?: string
}

/** 字段当前状态(读侧投影):档案列值 + 最新证据行;存量种子无证行 → evidence 为 null。 */
export interface FieldCurrent {
  value: unknown
  evidence: FieldEvidence | null
}

export type FieldVerdict =
  /** 接纳:新字段(当前无值),追加首行证据。 */
  | { decision: 'accept'; evidence: FieldEvidence }
  /**
   * 取代:旧值让位、旧行保留——新行追加后即该字段最新投影;previous = 被取代行的出处
   * (值同亦然:出处刷新,「同值再核验」留在历史;previous null = 存量旧值无证行,首次补证)。
   */
  | { decision: 'supersede'; evidence: FieldEvidence; previous: FieldEvidence | null }
  /** 冲突暂缓(跨信源/作用域冲突、证据不足、无权信源、字段不在矩阵)——终态,等证据指纹变化重开。 */
  | { decision: 'defer'; reason: string }

const scopeOf = (o: FieldObservation) => o.scope ?? 'global'
const includesApi = (v: unknown): boolean => Array.isArray(v) && v.includes('api')

/**
 * 提案 × 多源证据 → 字段级裁决(纯函数,票 03 主交付)。消费方 = 票 04 图内最终事务节点:
 * accept/supersede 携带的 evidence 即待追加行(append-only),defer 的 reason 落暂缓归因。
 * 幂等与同证据去重不在此(图内事务节点的状态守卫 + 冲突跳过,spec 实现决策)。
 */
export function adjudicateField(input: {
  modelId: number
  field: string
  /** 调查侧逐字段提案值(与观察值同构)。 */
  proposedValue: unknown
  /** 本轮多源观察(含全部信源角色;裁决按矩阵过滤有权者,无权观察不构成冲突)。 */
  observations: readonly FieldObservation[]
  /** 该字段当前状态;null = 新字段(档案尚无值)。 */
  current: FieldCurrent | null
  /** 裁决模型标识(调查+复核两段,票 04 传入;证据行元数据)。 */
  decidedModel: string
  decidedAt: string
}): FieldVerdict {
  const { modelId, field, proposedValue, observations, current, decidedModel, decidedAt } = input
  const rule = (FIELD_ADJUDICATION_MATRIX as Record<string, FieldRule | undefined>)[field]
  if (rule === undefined) return { decision: 'defer', reason: `字段 ${field} 不在裁决矩阵,无法裁决即暂缓` }
  // 有权判定(单点谓词):角色在矩阵内,且观察自己主张的值在该角色的可裁决值域内——
  // 越域主张(如 catalog 出目录推断 retired)= 无权观察,既不支撑提案也无否决权
  const mayClaim = (o: FieldObservation): boolean => {
    if (!rule.roles.includes(o.role)) return false
    const allowed = rule.roleValues?.[o.role]
    return allowed === undefined || (typeof o.value === 'string' && allowed.includes(o.value))
  }
  const supporting = observations.filter((o) => mayClaim(o) && isDeepStrictEqual(o.value, proposedValue))
  if (supporting.length === 0) {
    const anyEntitledRole = observations.some((o) => rule.roles.includes(o.role))
    return {
      decision: 'defer',
      reason: anyEntitledRole
        ? `证据不足:有权信源(${rule.roles.join('/')})观察不支撑提案值(值不一致或越出该角色可裁决值域)`
        : `证据不足:无有权信源(${rule.roles.join('/')})观察`,
    }
  }
  // 主证据 = 支持观察中观察时间最新者(出处更硬;同证据重放指纹不变,票 04 幂等守卫可用)
  const primary = supporting.reduce((a, b) => (b.observedAt > a.observedAt ? b : a))
  // 有权观察内的分歧:同作用域 = 跨信源冲突;异作用域 = 作用域冲突(纯函数不合并作用域,
  // 多作用域合并是调查侧的活)——都暂缓,理由串分开供归因(用户故事 21)
  for (const o of observations) {
    if (mayClaim(o) && !isDeepStrictEqual(o.value, proposedValue)) {
      return scopeOf(o) === scopeOf(primary)
        ? { decision: 'defer', reason: `跨信源冲突:有权信源 ${o.role} 的观察值与提案不一致(同作用域)` }
        : { decision: 'defer', reason: `作用域冲突:观察作用域 ${scopeOf(o)} 与 ${scopeOf(primary)} 不一致且值不一致,裁决不合并作用域` }
    }
  }
  // 目录在场是 availability 的必要非充分证据:提案含 api 须另有同作用域 catalog 在场观察;
  // 非充分已由 roles 保证(catalog 不在 availability.roles,单独永不足以确立)
  if (
    rule.catalogCorroboratesApi === true && includesApi(proposedValue) &&
    !observations.some((o) => o.role === 'catalog' && includesApi(o.value) && scopeOf(o) === scopeOf(primary))
  ) {
    return { decision: 'defer', reason: '证据不足:提案含 api 但无同作用域 catalog 在场观察(目录在场是必要非充分证据)' }
  }
  const evidence = buildEvidenceRow({ modelId, field, observation: primary, decidedModel, decidedAt })
  if (current === null) return { decision: 'accept', evidence }
  return { decision: 'supersede', evidence, previous: current.evidence }
}

/**
 * 证据行构造(原文片段、内容指纹、裁决规则版本、裁决模型与时刻齐备):缺任一要素即抛——
 * append-only 历史无法事后修补半空行,宁在构造处失败(票 04 图归系统错误)。
 */
function buildEvidenceRow(params: {
  modelId: number
  field: string
  observation: FieldObservation
  decidedModel: string
  decidedAt: string
}): FieldEvidence {
  const { modelId, field, observation: o, decidedModel, decidedAt } = params
  if (!Number.isInteger(modelId) || modelId <= 0) throw new Error(`证据行缺 modelId:${field}`)
  if (field.trim() === '') throw new Error('证据行缺字段名')
  if (o.sourceUrl.trim() === '' || o.excerpt.trim() === '') throw new Error(`证据行缺来源地址或原文片段:${field}`)
  if (o.observedAt.trim() === '' || decidedAt.trim() === '') throw new Error(`证据行缺观察或裁决时刻:${field}`)
  if (decidedModel.trim() === '') throw new Error(`证据行缺裁决模型:${field}`)
  return {
    modelId,
    field,
    sourceUrl: o.sourceUrl,
    observedAt: o.observedAt,
    excerpt: o.excerpt,
    // 证据内容指纹:SHA-256(字段+来源+观察时刻+原文片段)——同页不同字段、不同版本页面各行各异;
    // 同证据重放(observedAt 不变)指纹不变
    contentFingerprint: createHash('sha256').update(`${field}\n${o.sourceUrl}\n${o.observedAt}\n${o.excerpt}`).digest('hex'),
    ruleVersion: ADJUDICATION_RULE_VERSION,
    decidedModel,
    decidedAt,
  }
}
