import type { ModelEvent, ModelLimit, ModelPricing } from 'chrome-tab-shared'
import type { BaselineModel } from './modelTracking'

/**
 * DeepSeek 人工核验基线(issues/07)。全部资料于 2026-08-25 自官方一手信源核对:
 * - 模型动态(日期+原地升级史):API Change Log api-docs.deepseek.com/updates(HTML 无
 *   RSS,事件信源用节锚点 #<h3 id>)
 * - 现役模型/上下文/最大输出/并发/价格(USD 峰谷×缓存):官方 Models & Pricing 页
 *   api-docs.deepseek.com/quick_start/pricing
 * - 开放权重归属与日期:HuggingFace 官方 org deepseek-ai 实仓;训练参数量取官方
 *   模型卡明示值(V2/Coder-V2=236B/21B,V3/R1/V3.1=671B/37B;V2.5/V3.2 卡片未单独
 *   披露→null;Janus-Pro 1B/7B 双规格→null 不混记)
 *
 * 归并规则(CONTEXT.md「跟踪模型」:API ID 可能只是别名或快照,不另算模型):
 * - deepseek-chat / deepseek-reasoner / deepseek-coder 是**别名 ID**,历史上原地升级
 *   指向 V2→V2.5→V3→R1→V3.1→V3.2→V4-Flash——别名升级生成对应**模型**的动态,别名
 *   自身永不立行(V3.2-Speciale 曾有独立临时端点,属独立命名变体,立行);
 * - 同代日期/阶段快照(V2-0517/0628、V2.5-1210、V3-0324、R1-0528、V3.1-Terminus、
 *   V3.2-Exp、V4-Flash-0731、V4-Pro-0813)归并家族行,作为该行动态。
 * 退役口径:别名 2026-07-24 停用后历史各代无 API 渠道,权重仍在 HF → stage=retired
 * + availability=['open_weights'];Speciale 临时端点已过期 → availability=[](同智谱
 * GLM-Z1 先例)。排除项:纯论文、无权重/产品/API 的预告不立行;DeepSeek-VL2/Janus
 * 前代/OCR 等开放权重多模态模型未纳入本票(research §4 以 Janus-Pro 为权重代表),
 * 待人工核验后随基线纳入。
 */

/** DeepSeek API Change Log(主发布源,研究 §3;HTML,日期 h2 段 + h3 小节锚点)。 */
export const DEEPSEEK_UPDATES_URL = 'https://api-docs.deepseek.com/updates/'
/** Change Log 小节锚点(事件信源 = 与 pollDeepSeek 解析产键对齐,勿改动拼接形态)。 */
const CL = (anchor: string) => `${DEEPSEEK_UPDATES_URL}#${anchor}`
const PRICING_PAGE = { title: '官方 Models & Pricing', url: 'https://api-docs.deepseek.com/quick_start/pricing' }
/** 开放权重信源(HuggingFace 官方 deepseek-ai 实仓)。 */
const HF = (repo: string) => ({
  title: `开放权重(HuggingFace deepseek-ai/${repo})`,
  url: `https://huggingface.co/deepseek-ai/${repo}`,
})

/** 官方 API 现价:USD/百万 tokens,峰/谷两档数值直录(官方页两档均明示,低谷恰为高峰五折)。 */
const apiPrice = (hit: [string, string], miss: [string, string], out: [string, string]): ModelPricing => ({
  region: '官方 API api.deepseek.com(USD/百万 tokens)',
  effectiveFrom: null,
  entries: [
    { text: `输入(缓存命中)高峰 $${hit[0]}、低谷 $${hit[1]}`, scope: null },
    { text: `输入(缓存未命中)高峰 $${miss[0]}、低谷 $${miss[1]}`, scope: null },
    { text: `输出高峰 $${out[0]}、低谷 $${out[1]}`, scope: null },
  ],
})
/** 现役三模型限额(价格页 Model Details 口径;并发上限含在其中)。 */
const ctx = (context: string, maxOut: string, concurrency: string): ModelLimit[] => [
  { label: '上下文窗口', text: context, scope: null },
  { label: '最大输出', text: maxOut, scope: null },
  { label: '并发上限', text: concurrency, scope: null },
]

export const DEEPSEEK_BASELINE: BaselineModel[] = [
  // ---- 现役(官方 API)----
  {
    provider: 'deepseek',
    officialId: 'deepseek-v4-pro',
    name: 'DeepSeek-V4-Pro',
    kind: 'text',
    stage: 'ga',
    availability: ['api', 'first_party_app', 'open_weights'],
    summary: '新一代旗舰混合推理模型;2026-08-13 GA 原地升级(APP/Web/API 同步,调用方式不变),Agent 能力显著增强',
    sources: [PRICING_PAGE, { title: 'API Change Log(GA 原地升级)', url: CL('deepseek-v4-pro-update') }, HF('DeepSeek-V4-Pro-0813')],
    pricing: apiPrice(['0.044', '0.022'], ['1.32', '0.66'], ['3.96', '1.98']),
    limits: ctx('1M', '384K', '500'),
    trainingParams: null, // V4 基座规模官方未披露
    matchAliases: ['DeepSeek-V4-Pro', 'deepseek-v4-pro'],
    events: [
      { kind: 'weights_available', occurredOn: '2026-04-22', title: 'DeepSeek-V4-Pro 开放权重发布', sourceUrl: HF('DeepSeek-V4-Pro').url },
      { kind: 'api_available', occurredOn: '2026-04-24', title: 'DeepSeek-V4 上线:API 新增 V4-Pro 与 V4-Flash', sourceUrl: CL('deepseek-v4') },
      { kind: 'updated', occurredOn: '2026-08-13', title: 'DeepSeek-V4-Pro GA 发布(APP/Web/API 原地升级,调用方式不变)', sourceUrl: CL('deepseek-v4-pro-update') },
    ],
  },
  {
    provider: 'deepseek',
    officialId: 'deepseek-v4-flash',
    name: 'DeepSeek-V4-Flash',
    kind: 'text',
    stage: 'beta',
    availability: ['api', 'open_weights'],
    summary: '高性价比旗舰同源模型(官方 API 默认模型);2026-07-31 正式版公测原地升级,Agent 能力大幅增强',
    sources: [PRICING_PAGE, { title: 'API Change Log(公测原地升级)', url: CL('deepseek-v4-flash-update') }, HF('DeepSeek-V4-Flash-0731')],
    pricing: apiPrice(['0.014', '0.007'], ['0.44', '0.22'], ['1.32', '0.66']),
    limits: ctx('1M', '384K', '2500'),
    trainingParams: null,
    matchAliases: ['DeepSeek-V4-Flash', 'deepseek-v4-flash'],
    events: [
      { kind: 'weights_available', occurredOn: '2026-04-22', title: 'DeepSeek-V4-Flash 开放权重发布', sourceUrl: HF('DeepSeek-V4-Flash').url },
      { kind: 'api_available', occurredOn: '2026-04-24', title: 'DeepSeek-V4 上线:API 新增 V4-Pro 与 V4-Flash', sourceUrl: CL('deepseek-v4') },
      { kind: 'updated', occurredOn: '2026-07-31', title: 'DeepSeek-V4-Flash API 正式版公测(原地升级,调用方式不变)', sourceUrl: CL('deepseek-v4-flash-update') },
    ],
  },
  {
    provider: 'deepseek',
    officialId: 'deepseek-v4-flash-vision-exp',
    name: 'DeepSeek-V4-Flash-Vision-Exp',
    kind: 'multimodal_understanding',
    stage: 'experimental',
    availability: ['api'],
    summary: '实验性视觉理解模型:纯文本能力与 V4-Flash 持平,视觉 Agent 任务显著跃升;图像按尺寸折算 tokens 计费',
    sources: [PRICING_PAGE, { title: 'API Change Log(上线公告)', url: CL('deepseek-v4-flash-vision-exp-release') }],
    pricing: apiPrice(['0.014', '0.007'], ['0.44', '0.22'], ['1.32', '0.66']),
    limits: ctx('1M', '384K', '2500'),
    trainingParams: null,
    matchAliases: ['DeepSeek-V4-Flash-Vision-Exp', 'deepseek-v4-flash-vision-exp'],
    events: [
      { kind: 'api_available', occurredOn: '2026-08-21', title: 'DeepSeek-V4-Flash-Vision-Exp 实验模型上线(多模态视觉理解)', sourceUrl: CL('deepseek-v4-flash-vision-exp-release') },
    ],
  },
  // ---- 现役(开放权重)----
  {
    provider: 'deepseek',
    officialId: 'janus-pro',
    name: 'Janus-Pro',
    kind: 'multimodal_understanding', // 单一主要种类(CONTEXT.md「模型种类」不重复归类);文生图能力作为事实保留在 summary
    stage: 'ga',
    availability: ['open_weights'],
    summary: '解耦视觉编码的统一多模态理解与生成模型(1B/7B 双规格):兼具多模态理解与文生图能力,官方开放权重与实现',
    sources: [HF('Janus-Pro-7B'), HF('Janus-Pro-1B'), { title: '官方仓库(GitHub deepseek-ai/Janus)', url: 'https://github.com/deepseek-ai/Janus' }],
    pricing: null,
    limits: null,
    trainingParams: null, // 家族 1B/7B 双规格,官方未以单值披露,不混记
    matchAliases: ['Janus-Pro'],
    events: [
      { kind: 'weights_available', occurredOn: '2025-01-26', title: 'Janus-Pro 开放权重与实现发布(1B/7B)', sourceUrl: HF('Janus-Pro-7B').url },
    ],
  },
  // ---- 历史代(deepseek-chat/reasoner 别名原地升级的承接序列;别名 2026-07-24 停用)----
  {
    provider: 'deepseek',
    officialId: 'deepseek-v3.2',
    name: 'DeepSeek-V3.2',
    kind: 'text',
    stage: 'retired',
    availability: ['open_weights'],
    summary: 'deepseek-chat/deepseek-reasoner 别名升级的最后承接版本(经 V3.2-Exp 实验期转正式);别名已于 2026-07-24 停用',
    sources: [{ title: 'API Change Log(V3.2 发布)', url: CL('deepseek-v32') }, HF('DeepSeek-V3.2')],
    pricing: null,
    limits: null,
    trainingParams: null, // 官方卡片未单独披露
    matchAliases: ['DeepSeek-V3.2', 'DeepSeek-V3.2-Exp', 'deepseek-v3.2'],
    events: [
      { kind: 'api_available', occurredOn: '2025-09-29', title: 'deepseek-chat/reasoner 升级至 DeepSeek-V3.2-Exp', sourceUrl: CL('deepseek-v32-exp') },
      { kind: 'updated', occurredOn: '2025-12-01', title: 'deepseek-chat/reasoner 升级至 DeepSeek-V3.2 正式版', sourceUrl: CL('deepseek-v32') },
    ],
  },
  {
    provider: 'deepseek',
    officialId: 'deepseek-v3.2-speciale',
    name: 'DeepSeek-V3.2-Speciale',
    kind: 'text',
    stage: 'retired',
    availability: [], // 临时端点 2025-12-15 到期,无现行渠道(同智谱 GLM-Z1 退役口径)
    summary: '限时特别版:经临时端点提供、与 V3.2 同价、不支持工具调用,2025-12-15 端点到期后下线',
    sources: [{ title: 'API Change Log(Speciale 上线)', url: CL('deepseek-v32-speciale') }],
    pricing: null,
    limits: null,
    trainingParams: null,
    matchAliases: ['DeepSeek-V3.2-Speciale'],
    events: [
      { kind: 'api_available', occurredOn: '2025-12-01', title: 'DeepSeek-V3.2-Speciale 经临时端点上线(2025-12-15 到期)', sourceUrl: CL('deepseek-v32-speciale') },
      { kind: 'retired', occurredOn: '2025-12-15', title: 'Speciale 临时端点到期,模型下线', sourceUrl: CL('deepseek-v32-speciale') },
    ],
  },
  {
    provider: 'deepseek',
    officialId: 'deepseek-v3.1',
    name: 'DeepSeek-V3.1',
    kind: 'text',
    stage: 'retired',
    availability: ['open_weights'],
    summary: '混合推理架构:单模型同时支持思考/非思考模式,推理效率与 Agent 工具使用增强',
    sources: [{ title: 'API Change Log(V3.1 发布)', url: CL('deepseek-v31') }, HF('DeepSeek-V3.1')],
    pricing: null,
    limits: null,
    trainingParams: { total: '671B', active: '37B' },
    matchAliases: ['DeepSeek-V3.1', 'DeepSeek-V3.1-Terminus', 'deepseek-v3.1'],
    events: [
      { kind: 'api_available', occurredOn: '2025-08-21', title: 'deepseek-chat/reasoner 升级至 DeepSeek-V3.1', sourceUrl: CL('deepseek-v31') },
      { kind: 'updated', occurredOn: '2025-09-22', title: '升级至 DeepSeek-V3.1-Terminus(语言一致性与 Agent 优化)', sourceUrl: CL('deepseek-v31-terminus') },
    ],
  },
  {
    provider: 'deepseek',
    officialId: 'deepseek-r1',
    name: 'DeepSeek-R1',
    kind: 'text',
    stage: 'retired',
    availability: ['open_weights'],
    summary: '大规模强化学习训练的推理模型(deepseek-reasoner 别名首个承接版本),与 V3 同基座,权重开放',
    sources: [{ title: 'API Change Log(R1 上线)', url: CL('deepseek-reasoner-1') }, HF('DeepSeek-R1')],
    pricing: null,
    limits: null,
    trainingParams: { total: '671B', active: '37B' },
    matchAliases: ['DeepSeek-R1', 'deepseek-r1'],
    events: [
      { kind: 'api_available', occurredOn: '2025-01-20', title: 'deepseek-reasoner 上线,指向 DeepSeek-R1', sourceUrl: CL('deepseek-reasoner-1') },
      { kind: 'updated', occurredOn: '2025-05-28', title: 'deepseek-reasoner 升级至 DeepSeek-R1-0528', sourceUrl: CL('deepseek-reasoner') },
    ],
  },
  {
    provider: 'deepseek',
    officialId: 'deepseek-v3',
    name: 'DeepSeek-V3',
    kind: 'text',
    stage: 'retired',
    availability: ['open_weights'],
    summary: '671B 参数 MoE 旗舰(deepseek-chat 别名自 2024-12 起承接的通用模型)',
    sources: [{ title: 'API Change Log(V3 发布)', url: CL('deepseek-chat-1') }, HF('DeepSeek-V3')],
    pricing: null,
    limits: null,
    trainingParams: { total: '671B', active: '37B' },
    matchAliases: ['DeepSeek-V3', 'DeepSeek-V3-0324', 'deepseek-v3'],
    events: [
      { kind: 'api_available', occurredOn: '2024-12-26', title: 'deepseek-chat 升级至 DeepSeek-V3', sourceUrl: CL('deepseek-chat-1') },
      { kind: 'updated', occurredOn: '2025-03-24', title: 'deepseek-chat 升级至 DeepSeek-V3-0324', sourceUrl: CL('deepseek-chat') },
    ],
  },
  {
    provider: 'deepseek',
    officialId: 'deepseek-v2.5',
    name: 'DeepSeek-V2.5',
    kind: 'text',
    stage: 'retired',
    availability: ['open_weights'],
    summary: '通用与代码能力并轨的过渡版本(deepseek-chat 与 deepseek-coder 两别名首次同指)',
    sources: [{ title: 'API Change Log(V2.5 发布)', url: CL('deepseek-coder--deepseek-chat-upgraded-to-deepseek-v25-model') }, HF('DeepSeek-V2.5-1210')],
    pricing: null,
    limits: null,
    trainingParams: null, // 官方卡片未单独披露(与 V2 同架构)
    matchAliases: ['DeepSeek-V2.5', 'DeepSeek-V2.5-1210', 'deepseek-v2.5'],
    events: [
      { kind: 'api_available', occurredOn: '2024-09-05', title: 'deepseek-chat/deepseek-coder 合并升级至 DeepSeek-V2.5', sourceUrl: CL('deepseek-coder--deepseek-chat-upgraded-to-deepseek-v25-model') },
      { kind: 'updated', occurredOn: '2024-12-10', title: 'deepseek-chat 升级至 DeepSeek-V2.5-1210', sourceUrl: CL('deepseek-chat-2') },
    ],
  },
  {
    provider: 'deepseek',
    officialId: 'deepseek-coder-v2',
    name: 'DeepSeek-Coder-V2',
    kind: 'text',
    stage: 'retired',
    availability: ['open_weights'],
    summary: '236B MoE 代码模型(deepseek-coder 别名承接),2024-09-05 与通用线并轨至 V2.5',
    sources: [{ title: 'API Change Log(Coder-V2 发布)', url: CL('deepseek-coder-1') }, HF('DeepSeek-Coder-V2-Instruct')],
    pricing: null,
    limits: null,
    trainingParams: { total: '236B', active: '21B' },
    matchAliases: ['DeepSeek-Coder-V2', 'DeepSeek-Coder-V2-0614', 'DeepSeek-Coder-V2-0724', 'deepseek-coder-v2'],
    events: [
      { kind: 'api_available', occurredOn: '2024-06-14', title: 'deepseek-coder 升级至 DeepSeek-Coder-V2-0614', sourceUrl: CL('deepseek-coder-1') },
      { kind: 'updated', occurredOn: '2024-07-24', title: 'deepseek-coder 升级至 DeepSeek-Coder-V2-0724', sourceUrl: CL('deepseek-coder') },
      { kind: 'deprecated', occurredOn: '2024-09-05', title: 'deepseek-coder 与 deepseek-chat 并轨升级至 DeepSeek-V2.5', sourceUrl: CL('deepseek-coder--deepseek-chat-upgraded-to-deepseek-v25-model') },
    ],
  },
  {
    provider: 'deepseek',
    officialId: 'deepseek-v2',
    name: 'DeepSeek-V2',
    kind: 'text',
    stage: 'retired',
    availability: ['open_weights'],
    summary: '236B MoE(21B 激活)通用模型,DeepSeek MoE 路线起点(deepseek-chat 别名首个承接版本)',
    sources: [{ title: 'API Change Log(V2-0517 发布)', url: CL('deepseek-chat-4') }, HF('DeepSeek-V2')],
    pricing: null,
    limits: null,
    trainingParams: { total: '236B', active: '21B' },
    matchAliases: ['DeepSeek-V2', 'DeepSeek-V2-0517', 'DeepSeek-V2-0628', 'deepseek-v2'],
    events: [
      { kind: 'api_available', occurredOn: '2024-05-17', title: 'deepseek-chat 升级至 DeepSeek-V2-0517', sourceUrl: CL('deepseek-chat-4') },
      { kind: 'updated', occurredOn: '2024-06-28', title: 'deepseek-chat 升级至 DeepSeek-V2-0628', sourceUrl: CL('deepseek-chat-3') },
    ],
  },
]
