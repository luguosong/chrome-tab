import type { ModelLimit, ModelPricing } from 'chrome-tab-shared'
import type { BaselineModel } from './modelTracking'

/**
 * Anthropic 人工核验基线(issues/04)。全部资料于 2026-08-25 自官方一手信源核对:
 * - 模型清单/生命周期/退役日期:模型总览 docs platform.claude.com/docs/en/models/overview
 *   与模型弃用表 /docs/en/about-claude/model-deprecations(收录边界 = 弃用表 Model
 *   status 表的「Current and recently retired」:Active 10 + Retired 6;更早退役的
 *   1.x/2.x/3-sonnet/3-opus/3.5-sonnet 见弃用表 history,不在 status 表,不纳入)
 * - 价格(美元/百万 tokens,标准输入/输出):官方定价页 /docs/en/about-claude/pricing
 * - 上下文/最大输出:模型总览 comparison 表 + context windows 文档(1M 家族可输出至 128K;
 *   200K 旧模型的最大输出官方汇总页未列 → 不填,前端显示「未知」)
 * - 动态(上线/退役日期):Claude Platform release notes /docs/en/release-notes/overview
 * 归属与研究结论(research/sources.md §3/§4/§5):Claude 均以文本为唯一主要模型种类
 * (视觉输入是能力不是第二条记录);官方明确不提供自有 embedding(文档推荐的 Voyage AI
 * 是外部厂家)、无独立审核模型(通用 Claude 的审核用法指南不算)——基线均无对应行。
 * 仅限受邀访问的模型(Project Glasswing):2026-08-25 首轮核验时 Mythos 5 不在公开
 * 模型目录,决策「待公开发布后再核验纳入」;2026-09-02 复核,Mythos 5 / 5.1 已有公开
 * 模型页与公开定价行(invite-only 只是访问方式),排除前提失效,依原决策一并入档;
 * Mythos Preview 仍只见于迁移指南提及,不纳入。
 * ID 口径(研究 §5.3):4.6 世代起无日期后缀的 API ID 本身即固定快照(官方「Every
 * Claude model ID is a pinned snapshot, including the dateless IDs used from the 4.6
 * generation on」),不作移动别名处理,直接入档;4.5 及之前世代的日期后缀 ID
 * (-20251101 等)是快照,归并家族行。
 */

/** 平台/地区作用域(全部现价均为 Claude API 美元标准价)。 */
const API = 'Claude API(美元标准价)'
const PRICING_PAGE = { title: '官方定价页', url: 'https://platform.claude.com/docs/en/about-claude/pricing' }
const OVERVIEW_PAGE = { title: '模型总览', url: 'https://platform.claude.com/docs/en/about-claude/models/overview' }
const DEPRECATIONS_PAGE = { title: '模型弃用表', url: 'https://platform.claude.com/docs/en/about-claude/model-deprecations' }
const RELEASE_NOTES_PAGE = { title: 'Platform release notes', url: 'https://platform.claude.com/docs/en/release-notes/overview' }
const NEWS = (slug: string) => `https://www.anthropic.com/news/${slug}`

const price = (input: string, output: string): ModelPricing => ({
  region: API,
  effectiveFrom: null,
  entries: [
    { text: `输入 ${input} 美元/百万 tokens`, scope: null },
    { text: `输出 ${output} 美元/百万 tokens`, scope: null },
  ],
})
/** 「上下文/最大输出」限额对;最大输出官方汇总未列 → 只填上下文。 */
const ctx = (context: string, maxOut: string | null): ModelLimit[] =>
  maxOut === null
    ? [{ label: '上下文窗口', text: context, scope: null }]
    : [
        { label: '上下文窗口', text: context, scope: null },
        { label: '最大输出', text: maxOut, scope: null },
      ]

export const ANTHROPIC_BASELINE: BaselineModel[] = [
  // ---- 当前 lineup(总览 comparison 表)----
  {
    provider: 'anthropic',
    officialId: 'claude-fable-5-1',
    name: 'Claude Fable 5.1',
    kind: 'text',
    stage: 'ga',
    availability: ['api'],
    summary: 'Anthropic 当前能力最强的公开发布模型(Fable 5 后继):长时程智能体、编程与研究,自适应思考常开,缓存读降至输入价 0.025 倍',
    sources: [
      { title: 'Claude Fable 5.1 模型页', url: 'https://platform.claude.com/docs/en/models/fable-5-1/overview' },
      OVERVIEW_PAGE,
      PRICING_PAGE,
    ],
    pricing: price('10', '50'),
    limits: ctx('1M', '128K'),
    trainingParams: null, // Anthropic 从未披露任何 Claude 模型的参数量
    matchAliases: ['Claude Fable 5.1', 'claude-fable-5-1'],
    matchSlugs: ['claude-fable-5-1', 'fable-5-1'],
    // 发布条目末链即此页(与轮询认领的 sourceUrl 逐字一致,历史去重同键不产重复行)
    events: [
      { kind: 'api_available', occurredOn: '2026-09-01', title: 'Claude Fable 5.1 发布,Fable 5 的长时程后继', sourceUrl: 'https://platform.claude.com/docs/en/models/fable-5-1/whats-new-fable-5-1' },
    ],
  },
  {
    provider: 'anthropic',
    officialId: 'claude-fable-5',
    name: 'Claude Fable 5',
    kind: 'text',
    stage: 'ga',
    availability: ['api'],
    summary: 'Anthropic 当前能力最强的公开发布模型:面向长时运行智能体,自适应思考常开,支持文本与图像输入',
    sources: [
      { title: 'Claude Fable 5 模型页', url: 'https://platform.claude.com/docs/en/models/fable-5/overview' },
      OVERVIEW_PAGE,
      PRICING_PAGE,
    ],
    pricing: price('10', '50'),
    limits: ctx('1M', '128K'),
    trainingParams: null, // Anthropic 从未披露任何 Claude 模型的参数量
    matchAliases: ['Claude Fable 5', 'claude-fable-5'],
    // 发布公告 slug 为 introducing-claude-fable-5-and-claude-mythos-5,'fable-5' 后随 '-and'
    // 会被词边界拒掉,须整串收录(slug 尾边界见 providers/def.ts 的 slugIn)
    matchSlugs: ['claude-fable-5', 'fable-5', 'introducing-claude-fable-5-and-claude-mythos-5'],
    events: [
      { kind: 'api_available', occurredOn: '2026-06-09', title: 'Claude Fable 5 发布,最强公开发布模型', sourceUrl: 'https://platform.claude.com/docs/en/models/fable-5/introducing-claude-fable-5-and-claude-mythos-5' },
    ],
  },
  // ---- Invite only(Project Glasswing):公开模型页 + 公开定价行,访问受邀(2026-09-02 入档)----
  // 行序须在 Fable 5 之后:共公告条目(6-09 发布)alias+slug 双命中两行,由基线行序归主模型
  {
    provider: 'anthropic',
    officialId: 'claude-mythos-5',
    name: 'Claude Mythos 5',
    kind: 'text',
    stage: 'ga',
    availability: ['api'],
    summary: '面向防御性网络安全与生命科学研究的受邀模型(Project Glasswing):与 Fable 5 同规格同价,自适应思考常开',
    sources: [
      { title: 'Claude Mythos 5 模型页', url: 'https://platform.claude.com/docs/en/models/mythos-5/overview' },
      PRICING_PAGE,
    ],
    pricing: price('10', '50'),
    limits: ctx('1M', '128K'),
    trainingParams: null,
    matchAliases: ['Claude Mythos 5', 'claude-mythos-5'],
    matchSlugs: ['claude-mythos-5', 'mythos-5'],
    events: [
      // 与 Fable 5 同发布公告;该条目由基线行序归 Fable 5,Mythos 5 的上线动态在此锚定
      { kind: 'api_available', occurredOn: '2026-06-09', title: 'Claude Mythos 5 发布(Project Glasswing 受邀访问)', sourceUrl: 'https://platform.claude.com/docs/en/models/fable-5/introducing-claude-fable-5-and-claude-mythos-5' },
    ],
  },
  {
    provider: 'anthropic',
    officialId: 'claude-mythos-5-1',
    name: 'Claude Mythos 5.1',
    kind: 'text',
    stage: 'ga',
    availability: ['api'],
    summary: 'Fable 5.1 的受邀版本(Project Glasswing):同规格同价,面向防御性网络安全与生命科学研究',
    sources: [
      { title: 'Claude Mythos 5.1 模型页', url: 'https://platform.claude.com/docs/en/models/mythos-5-1/overview' },
      PRICING_PAGE,
    ],
    pricing: price('10', '50'),
    limits: ctx('1M', '128K'),
    trainingParams: null,
    matchAliases: ['Claude Mythos 5.1', 'claude-mythos-5-1'],
    matchSlugs: ['claude-mythos-5-1', 'mythos-5-1'],
    events: [
      { kind: 'api_available', occurredOn: '2026-09-01', title: 'Claude Mythos 5.1 发布(Project Glasswing 受邀访问)', sourceUrl: 'https://www.anthropic.com/claude-fable-and-mythos-5-1' },
    ],
  },
  {
    provider: 'anthropic',
    officialId: 'claude-opus-5',
    name: 'Claude Opus 5',
    kind: 'text',
    stage: 'ga',
    availability: ['api'],
    summary: '面向复杂智能体编程与企业级工作的旗舰;1M 上下文,思考默认开启,定价与 Opus 4.8 持平',
    sources: [
      { title: 'Claude Opus 5 模型页', url: 'https://platform.claude.com/docs/en/models/opus-5/overview' },
      OVERVIEW_PAGE,
      PRICING_PAGE,
    ],
    pricing: price('5', '25'),
    limits: ctx('1M', '128K'),
    trainingParams: null,
    matchAliases: ['Claude Opus 5', 'claude-opus-5'],
    matchSlugs: ['claude-opus-5', 'opus-5'],
    events: [
      { kind: 'api_available', occurredOn: '2026-07-24', title: 'Claude Opus 5 发布,较 Opus 4.8 显著升级', sourceUrl: 'https://platform.claude.com/docs/en/models/opus-5/whats-new-opus-5' },
    ],
  },
  {
    provider: 'anthropic',
    officialId: 'claude-sonnet-5',
    name: 'Claude Sonnet 5',
    kind: 'text',
    stage: 'ga',
    availability: ['api'],
    summary: '速度与智能兼顾的新一代 Sonnet;1M 上下文,自适应思考默认开启,上线价 2/10 美元已于 2026-08-10 转为标准价',
    sources: [
      { title: 'Claude Sonnet 5 模型页', url: 'https://platform.claude.com/docs/en/models/sonnet-5/overview' },
      OVERVIEW_PAGE,
      PRICING_PAGE,
    ],
    pricing: price('2', '10'),
    limits: ctx('1M', '128K'),
    trainingParams: null,
    matchAliases: ['Claude Sonnet 5', 'claude-sonnet-5'],
    matchSlugs: ['claude-sonnet-5', 'sonnet-5'],
    events: [
      { kind: 'api_available', occurredOn: '2026-06-30', title: 'Claude Sonnet 5 发布,新一代 Sonnet', sourceUrl: 'https://platform.claude.com/docs/en/models/sonnet-5/whats-new-sonnet-5' },
    ],
  },
  {
    provider: 'anthropic',
    officialId: 'claude-haiku-4-5',
    name: 'Claude Haiku 4.5',
    kind: 'text',
    stage: 'ga',
    availability: ['api'],
    summary: '最快且接近前沿智能的 Haiku;支持文本与图像输入。API 快照 ID 为 claude-haiku-4-5-20251001,别名 claude-haiku-4-5',
    sources: [
      { title: 'Claude Haiku 4.5 模型页', url: 'https://platform.claude.com/docs/en/models/haiku-4-5/overview' },
      OVERVIEW_PAGE,
      PRICING_PAGE,
    ],
    pricing: price('1', '5'),
    limits: ctx('200K', '64K'),
    trainingParams: null,
    matchAliases: ['Claude Haiku 4.5', 'claude-haiku-4-5-20251001', 'claude-haiku-4-5'],
    matchSlugs: ['claude-haiku-4-5', 'haiku-4-5'],
    events: [
      { kind: 'api_available', occurredOn: '2025-10-15', title: 'Claude Haiku 4.5 发布', sourceUrl: NEWS('claude-haiku-4-5') },
    ],
  },
  // ---- Legacy(总览「still available」+ 弃用表 status 表 Active)----
  {
    provider: 'anthropic',
    officialId: 'claude-opus-4-8',
    name: 'Claude Opus 4.8',
    kind: 'text',
    stage: 'ga',
    availability: ['api'],
    summary: 'Opus 5 前代的旗舰:1M 上下文默认开启,高分辨率图像输入,定价与后续 Opus 持平',
    sources: [
      { title: 'Claude Opus 4.8 模型页', url: 'https://platform.claude.com/docs/en/models/opus-4-8/overview' },
      OVERVIEW_PAGE,
      PRICING_PAGE,
    ],
    pricing: price('5', '25'),
    limits: ctx('1M', '128K'),
    trainingParams: null,
    matchAliases: ['Claude Opus 4.8', 'claude-opus-4-8'],
    matchSlugs: ['claude-opus-4-8', 'opus-4-8'],
    events: [
      { kind: 'api_available', occurredOn: '2026-05-28', title: 'Claude Opus 4.8 发布', sourceUrl: NEWS('claude-opus-4-8') },
    ],
  },
  {
    provider: 'anthropic',
    officialId: 'claude-opus-4-7',
    name: 'Claude Opus 4.7',
    kind: 'text',
    stage: 'ga',
    availability: ['api'],
    summary: '面向复杂推理与长时任务的 Opus;新分词器与高分辨率图像输入自本代引入',
    sources: [
      { title: 'Claude Opus 4.7 模型页', url: 'https://platform.claude.com/docs/en/models/opus-4-7/overview' },
      OVERVIEW_PAGE,
      PRICING_PAGE,
    ],
    pricing: price('5', '25'),
    limits: ctx('1M', '128K'),
    trainingParams: null,
    matchAliases: ['Claude Opus 4.7', 'claude-opus-4-7'],
    matchSlugs: ['claude-opus-4-7', 'opus-4-7'],
    events: [
      { kind: 'api_available', occurredOn: '2026-04-16', title: 'Claude Opus 4.7 发布', sourceUrl: NEWS('claude-opus-4-7') },
    ],
  },
  {
    provider: 'anthropic',
    officialId: 'claude-opus-4-6',
    name: 'Claude Opus 4.6',
    kind: 'text',
    stage: 'ga',
    availability: ['api'],
    summary: '面向智能体长程任务的 Opus;无日期后缀的 API ID 自本代起即为固定快照',
    sources: [
      { title: 'Claude Opus 4.6 模型页', url: 'https://platform.claude.com/docs/en/models/opus-4-6/overview' },
      OVERVIEW_PAGE,
      PRICING_PAGE,
    ],
    pricing: price('5', '25'),
    limits: ctx('1M', '128K'),
    trainingParams: null,
    matchAliases: ['Claude Opus 4.6', 'claude-opus-4-6'],
    matchSlugs: ['claude-opus-4-6', 'opus-4-6'],
    events: [
      { kind: 'api_available', occurredOn: '2026-02-05', title: 'Claude Opus 4.6 发布', sourceUrl: NEWS('claude-opus-4-6') },
    ],
  },
  {
    provider: 'anthropic',
    officialId: 'claude-opus-4-5',
    name: 'Claude Opus 4.5',
    kind: 'text',
    stage: 'ga',
    availability: ['api'],
    summary: '兼顾最强能力与实用性的 Opus;API 快照 ID 为 claude-opus-4-5-20251101',
    sources: [
      { title: 'Claude Opus 4.5 模型页', url: 'https://platform.claude.com/docs/en/models/opus-4-5/overview' },
      OVERVIEW_PAGE,
      PRICING_PAGE,
    ],
    pricing: price('5', '25'),
    limits: ctx('200K', null),
    trainingParams: null,
    matchAliases: ['Claude Opus 4.5', 'claude-opus-4-5-20251101', 'claude-opus-4-5'],
    matchSlugs: ['claude-opus-4-5', 'opus-4-5'],
    events: [
      { kind: 'api_available', occurredOn: '2025-11-24', title: 'Claude Opus 4.5 发布', sourceUrl: NEWS('claude-opus-4-5') },
    ],
  },
  {
    provider: 'anthropic',
    officialId: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6',
    kind: 'text',
    stage: 'ga',
    availability: ['api'],
    summary: '速度与智能兼顾的 Sonnet;1M 上下文 2026-03-13 起脱离 beta 按标准价提供',
    sources: [
      { title: 'Claude Sonnet 4.6 模型页', url: 'https://platform.claude.com/docs/en/models/sonnet-4-6/overview' },
      OVERVIEW_PAGE,
      PRICING_PAGE,
    ],
    pricing: price('3', '15'),
    limits: ctx('1M', '128K'),
    trainingParams: null,
    matchAliases: ['Claude Sonnet 4.6', 'claude-sonnet-4-6'],
    matchSlugs: ['claude-sonnet-4-6', 'sonnet-4-6'],
    events: [
      { kind: 'api_available', occurredOn: '2026-02-17', title: 'Claude Sonnet 4.6 发布', sourceUrl: NEWS('claude-sonnet-4-6') },
    ],
  },
  {
    provider: 'anthropic',
    officialId: 'claude-sonnet-4-5',
    name: 'Claude Sonnet 4.5',
    kind: 'text',
    stage: 'ga',
    availability: ['api'],
    summary: '面向复杂智能体与编程的 Sonnet;API 快照 ID 为 claude-sonnet-4-5-20250929',
    sources: [
      { title: 'Claude Sonnet 4.5 模型页', url: 'https://platform.claude.com/docs/en/models/sonnet-4-5/overview' },
      OVERVIEW_PAGE,
      PRICING_PAGE,
    ],
    pricing: price('3', '15'),
    limits: ctx('200K', null),
    trainingParams: null,
    matchAliases: ['Claude Sonnet 4.5', 'claude-sonnet-4-5-20250929', 'claude-sonnet-4-5'],
    matchSlugs: ['claude-sonnet-4-5', 'sonnet-4-5'],
    events: [
      { kind: 'api_available', occurredOn: '2025-09-29', title: 'Claude Sonnet 4.5 发布', sourceUrl: NEWS('claude-sonnet-4-5') },
    ],
  },
  // ---- 已退役(弃用表 status 表 Retired;发布/退役日期经 release notes 与弃用表核验)----
  {
    provider: 'anthropic',
    officialId: 'claude-opus-4-1',
    name: 'Claude Opus 4.1',
    kind: 'text',
    stage: 'retired',
    availability: ['api'],
    summary: 'Opus 4 的增量更新;API 快照 ID 为 claude-opus-4-1-20250805。2026-08-05 已退役(仅 Bedrock/Google Cloud 仍提供)',
    sources: [DEPRECATIONS_PAGE, OVERVIEW_PAGE, PRICING_PAGE],
    pricing: price('15', '75'),
    limits: ctx('200K', null),
    trainingParams: null,
    matchAliases: ['Claude Opus 4.1', 'claude-opus-4-1-20250805', 'claude-opus-4-1'],
    matchSlugs: ['claude-opus-4-1', 'opus-4-1'],
    events: [
      { kind: 'api_available', occurredOn: '2025-08-05', title: 'Claude Opus 4.1 发布', sourceUrl: NEWS('claude-opus-4-1') },
      { kind: 'deprecated', occurredOn: '2026-06-05', title: '宣布弃用 Claude Opus 4.1,建议迁移至 Claude Opus 4.8', sourceUrl: DEPRECATIONS_PAGE.url },
      { kind: 'retired', occurredOn: '2026-08-05', title: 'Claude Opus 4.1 退役', sourceUrl: DEPRECATIONS_PAGE.url },
    ],
  },
  {
    provider: 'anthropic',
    officialId: 'claude-opus-4',
    name: 'Claude Opus 4',
    kind: 'text',
    stage: 'retired',
    availability: ['api'],
    summary: 'Claude 4 世代的 Opus(扩展思考);API 快照 ID 为 claude-opus-4-20250514。2026-06-15 已退役(仅 Google Cloud 仍提供)',
    sources: [DEPRECATIONS_PAGE, OVERVIEW_PAGE, PRICING_PAGE],
    pricing: price('15', '75'),
    limits: ctx('200K', null),
    trainingParams: null,
    matchAliases: ['Claude Opus 4', 'claude-opus-4-20250514'],
    // 发布公告(news/claude-4)单链接同时覆盖 Opus 4 与 Sonnet 4 两家,别名各自认领
    matchSlugs: ['claude-opus-4-20250514', 'news/claude-4'],
    events: [
      { kind: 'api_available', occurredOn: '2025-05-22', title: 'Claude Opus 4 与 Claude Sonnet 4 发布', sourceUrl: NEWS('claude-4') },
      { kind: 'deprecated', occurredOn: '2026-04-14', title: '宣布弃用 Claude Opus 4 与 Claude Sonnet 4,建议迁移至 Opus 4.8 / Sonnet 4.6', sourceUrl: DEPRECATIONS_PAGE.url },
      { kind: 'retired', occurredOn: '2026-06-15', title: 'Claude Opus 4 与 Claude Sonnet 4 退役', sourceUrl: DEPRECATIONS_PAGE.url },
    ],
  },
  {
    provider: 'anthropic',
    officialId: 'claude-sonnet-4',
    name: 'Claude Sonnet 4',
    kind: 'text',
    stage: 'retired',
    availability: ['api'],
    summary: 'Claude 4 世代的 Sonnet(扩展思考);API 快照 ID 为 claude-sonnet-4-20250514。2026-06-15 已退役(仅 Bedrock/Google Cloud 仍提供)',
    sources: [DEPRECATIONS_PAGE, OVERVIEW_PAGE, PRICING_PAGE],
    pricing: price('3', '15'),
    limits: ctx('200K', null),
    trainingParams: null,
    matchAliases: ['Claude Sonnet 4', 'claude-sonnet-4-20250514'],
    matchSlugs: ['claude-sonnet-4-20250514', 'news/claude-4'],
    events: [
      { kind: 'api_available', occurredOn: '2025-05-22', title: 'Claude Opus 4 与 Claude Sonnet 4 发布', sourceUrl: NEWS('claude-4') },
      { kind: 'deprecated', occurredOn: '2026-04-14', title: '宣布弃用 Claude Opus 4 与 Claude Sonnet 4,建议迁移至 Opus 4.8 / Sonnet 4.6', sourceUrl: DEPRECATIONS_PAGE.url },
      { kind: 'retired', occurredOn: '2026-06-15', title: 'Claude Opus 4 与 Claude Sonnet 4 退役', sourceUrl: DEPRECATIONS_PAGE.url },
    ],
  },
  {
    provider: 'anthropic',
    officialId: 'claude-3-7-sonnet',
    name: 'Claude Sonnet 3.7',
    kind: 'text',
    stage: 'retired',
    availability: ['api'],
    summary: '首个混合推理的 Sonnet(可开关扩展思考);API 快照 ID 为 claude-3-7-sonnet-20250219。2026-02-19 已退役',
    sources: [DEPRECATIONS_PAGE, OVERVIEW_PAGE],
    pricing: null, // 定价页已不再列示退役旧型号现价
    limits: ctx('200K', null),
    trainingParams: null,
    matchAliases: ['Claude Sonnet 3.7', 'claude-3-7-sonnet-20250219', 'claude-3-7-sonnet'],
    matchSlugs: ['claude-3-7-sonnet', '3-7-sonnet'],
    events: [
      { kind: 'api_available', occurredOn: '2025-02-24', title: 'Claude Sonnet 3.7 发布', sourceUrl: NEWS('claude-3-7-sonnet') },
      { kind: 'deprecated', occurredOn: '2025-10-28', title: '宣布弃用 Claude Sonnet 3.7', sourceUrl: DEPRECATIONS_PAGE.url },
      { kind: 'retired', occurredOn: '2026-02-19', title: 'Claude Sonnet 3.7 与 Claude Haiku 3.5 退役', sourceUrl: DEPRECATIONS_PAGE.url },
    ],
  },
  {
    provider: 'anthropic',
    officialId: 'claude-3-5-haiku',
    name: 'Claude Haiku 3.5',
    kind: 'text',
    stage: 'retired',
    availability: ['api'],
    summary: 'Haiku 3.5,2024-11-04 起 API 可用(初为纯文本,2025-02-24 增加视觉);API 快照 ID 为 claude-3-5-haiku-20241022。2026-02-19 已退役',
    sources: [DEPRECATIONS_PAGE, OVERVIEW_PAGE, PRICING_PAGE],
    pricing: price('0.80', '4'),
    limits: ctx('200K', null),
    trainingParams: null,
    matchAliases: ['Claude Haiku 3.5', 'claude-3-5-haiku-20241022', 'claude-3-5-haiku'],
    matchSlugs: ['claude-3-5-haiku', '3-5-haiku'],
    events: [
      // 发布条目链接至产品页(无本型号 slug),信源落 release notes 总页;自动解析永不产同键
      { kind: 'api_available', occurredOn: '2024-11-04', title: 'Claude Haiku 3.5 在 Claude API 上线', sourceUrl: RELEASE_NOTES_PAGE.url },
      { kind: 'deprecated', occurredOn: '2025-12-19', title: '宣布弃用 Claude Haiku 3.5', sourceUrl: DEPRECATIONS_PAGE.url },
      { kind: 'retired', occurredOn: '2026-02-19', title: 'Claude Sonnet 3.7 与 Claude Haiku 3.5 退役', sourceUrl: DEPRECATIONS_PAGE.url },
    ],
  },
  {
    provider: 'anthropic',
    officialId: 'claude-3-haiku',
    name: 'Claude Haiku 3',
    kind: 'text',
    stage: 'retired',
    availability: ['api'],
    summary: '第三代 Haiku;API 快照 ID 为 claude-3-haiku-20240307。2026-04-20 已退役',
    sources: [DEPRECATIONS_PAGE, OVERVIEW_PAGE],
    pricing: null, // 定价页已不再列示退役旧型号现价
    limits: ctx('200K', null),
    trainingParams: null,
    matchAliases: ['Claude Haiku 3', 'claude-3-haiku-20240307', 'claude-3-haiku'],
    matchSlugs: ['claude-3-haiku', '3-haiku'],
    events: [
      // 发布早于 release notes 覆盖起点(2024-05-10),官方可证实的只有弃用与退役
      { kind: 'deprecated', occurredOn: '2026-02-19', title: '宣布弃用 Claude Haiku 3,建议迁移至 Claude Haiku 4.5', sourceUrl: DEPRECATIONS_PAGE.url },
      { kind: 'retired', occurredOn: '2026-04-20', title: 'Claude Haiku 3 退役', sourceUrl: DEPRECATIONS_PAGE.url },
    ],
  },
]
