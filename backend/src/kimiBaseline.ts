import type { ModelLimit, ModelPricing } from 'chrome-tab-shared'
import type { BaselineModel } from './modelTracking'

/**
 * 月之暗面(Kimi)人工核验基线(issues/06)。全部资料于 2026-08-25 自官方一手信源核对:
 * - 模型清单/上下文/下线口径:开放平台模型列表 platform.kimi.com/docs/models.md
 *   (多模态表 + Moonshot V1 表 + 已下线表;kimi-k2 系列 2026-05-25 下线、
 *   kimi-latest 2026-01-28 下线、kimi-thinking-preview 2025-11-11 下线;
 *   K3 发布后 kimi-k2.5 与 moonshot-v1 已停新注册用户,2026-08-31 全平台下线)
 * - 价格(人民币/百万 tokens,缓存命中/未命中分列):各模型定价页
 *   docs/pricing/chat-k3 · chat-k27-code · chat-k26 · chat-k25 · chat-v1
 * - 动态(发布/开放权重/下线日期):Kimi 资讯 www.kimi.com/news(产品发布)、
 *   Kimi Blog www.kimi.com/en/blog(研究/开放权重,索引卡片带官方日期);K3 仓库
 *   先建后发,权重日取资讯「开放日」口径而非仓库创建日(研究 §3:仓库创建≠发布)
 * - 开放权重:HuggingFace 官方 org moonshotai 实仓核验(K3/K2.7-Code/K2.6/K2.5/
 *   K2/K2-Thinking/Kimi-Audio 均有 safetensors 权重)
 * 归属与排除(研究 §2/§4/§5):商业目录模型全部纳入;Kimi-Audio 虽不在商业 API,
 * 但官方仓库提供权重/实现与明确发布说明,以 open_weights 渠道纳入(不标 API 可用)。
 * 不纳入:kimi-latest(移动别名,引用方式不另立模型);K3 开放日同步开源的 Infra
 * 组件(MoonEP/FlashKDA/AgentEnv,非模型);研究仓库 Kimi-VL/Kimi-Dev/Kimi-Linear/
 * Moonlight/MoonViT(不在商业目录,研究 §2 Kimi 覆盖矩阵亦未列,待后续核验)。
 * 归并规则(issues/02 同口径):kimi-k2 的 0711/0905 日期快照归并家族行(0905 权重
 * 更新为家族行上的一条动态);moonshot-v1 上下文档位(8k/32k/128k)归并,vision
 * 变体因模型种类不同独立成行;K2.7 Code HighSpeed 官方明示与 K2.7 Code 同模型,
 * 但独立 API ID/独立定价 → 分立成行。
 */

/** 平台/地区作用域(全部现价均为 Kimi 开放平台人民币价)。 */
const CN = 'Kimi 开放平台(platform.kimi.com,人民币)'
const MODELS_PAGE = { title: '模型列表(开放平台)', url: 'https://platform.kimi.com/docs/models.md' }
const PRICING = (slug: string) => ({ title: '官方定价页', url: `https://platform.kimi.com/docs/pricing/${slug}` })
/** 资讯文章(商业发布)。 */
const NEWS = (slug: string) => `https://www.kimi.com/news/${slug}`
/** Blog 文章(研究/开放权重发布)。 */
const BLOG = (slug: string) => `https://www.kimi.com/en/blog/${slug}`
/** 开放权重信源(HuggingFace 官方 moonshotai 实仓)。 */
const HF = (repo: string) => ({ title: `开放权重(HuggingFace MoonshotAI/${repo})`, url: `https://huggingface.co/MoonshotAI/${repo}` })

/** 现行商业模型价(输入缓存命中/未命中 + 输出,¥/百万 tokens;定价页三列口径)。 */
const perM = (hit: string, miss: string, output: string): ModelPricing => ({
  region: CN,
  effectiveFrom: null,
  entries: [
    { text: `输入(缓存命中)¥${hit}/百万 tokens`, scope: null },
    { text: `输入(缓存未命中)¥${miss}/百万 tokens`, scope: null },
    { text: `输出 ¥${output}/百万 tokens`, scope: null },
  ],
})
/** Moonshot V1 档位价(无缓存分列;scope = 档位对应的官方模型 ID 原文)。 */
const perMTier = (...tiers: Array<[string, string, string]>): ModelPricing => ({
  region: CN,
  effectiveFrom: null,
  entries: tiers.flatMap(([id, input, output]) => [
    { text: `输入 ¥${input}/百万 tokens`, scope: id },
    { text: `输出 ¥${output}/百万 tokens`, scope: id },
  ]),
})
/** 上下文窗口限额(Kimi 定价页单列口径,官方原文数值)。 */
const ctx = (tokens: string): ModelLimit[] => [{ label: '上下文窗口', text: tokens, scope: null }]

export const KIMI_BASELINE: BaselineModel[] = [
  // ---- 多模态模型表(当前 lineup)----
  {
    provider: 'moonshot',
    officialId: 'kimi-k3',
    name: 'Kimi K3',
    kind: 'text',
    stage: 'ga',
    availability: ['api', 'open_weights'], // 发布即称开源,权重于发布 10 日后「开放日」公布
    summary: '月之暗面旗舰:2.8 万亿参数 MoE、原生视觉理解、100 万 token 上下文,面向长程编程与深度推理',
    sources: [MODELS_PAGE, PRICING('chat-k3'), HF('Kimi-K3')],
    pricing: perM('2.00', '20.00', '100.00'),
    limits: ctx('1,048,576 tokens'),
    trainingParams: { total: '2.8万亿', active: null }, // 官方仅披露「896 路由专家激活 16」(专家数非参数量),激活参数量未披露
    matchAliases: ['Kimi K3'],
    events: [
      { kind: 'api_available', occurredOn: '2026-07-17', title: 'Kimi K3:智能的新前沿(正式发布)', sourceUrl: NEWS('kimi-k3') },
      { kind: 'weights_available', occurredOn: '2026-07-27', title: 'Kimi K3 开放日:模型权重、技术报告和关键 Infra 技术同步开放', sourceUrl: NEWS('kimi-k3-open-source') },
    ],
  },
  {
    provider: 'moonshot',
    officialId: 'kimi-k2.7-code',
    name: 'Kimi K2.7 Code',
    kind: 'text', // 研究 §2 文本列(视觉输入是能力进 summary,同 GPT-5.6 先例;K2.6 因研究矩阵明确列于多模态理解列)
    stage: 'ga',
    availability: ['api', 'open_weights'],
    summary: 'Kimi 的 Coding 模型:长上下文中更可靠遵循指令,支持文本/图片/视频输入,256K 上下文',
    sources: [MODELS_PAGE, PRICING('chat-k27-code'), HF('Kimi-K2.7-Code')],
    pricing: perM('1.30', '6.50', '27.00'),
    limits: ctx('262,144 tokens'),
    trainingParams: null,
    matchAliases: ['Kimi K2.7 Code', 'Kimi K2.7-Code'],
    // 无带日期的官方发布文章(资讯/Blog 均无)——研究 §3「仓库创建不等于发布」,不借
    // HF 仓库创建日臆造 weights_available 日期;open_weights 渠道本身是 HF 权重实核事实
  },
  {
    provider: 'moonshot',
    officialId: 'kimi-k2.7-code-highspeed',
    name: 'Kimi K2.7 Code HighSpeed',
    kind: 'text',
    stage: 'ga',
    availability: ['api'], // 高速服务档,官方明示「与 K2.7 Code 是相同模型」,无独立权重
    summary: 'K2.7 Code 的高速版(同一模型的高速服务):输出约 180 tokens/s,短上下文场景可达 260 tokens/s',
    sources: [MODELS_PAGE, PRICING('chat-k27-code')],
    pricing: perM('2.60', '13.00', '54.00'),
    limits: ctx('262,144 tokens'),
    trainingParams: null,
    matchAliases: ['Kimi K2.7 Code HighSpeed', 'Kimi K2.7-Code-HighSpeed'],
  },
  {
    provider: 'moonshot',
    officialId: 'kimi-k2.6',
    name: 'Kimi K2.6',
    kind: 'multimodal_understanding',
    stage: 'ga',
    availability: ['api', 'open_weights'],
    summary: '支持视觉与文本输入、思考与非思考模式、对话与 Agent 任务,256K 上下文',
    sources: [MODELS_PAGE, PRICING('chat-k26'), HF('Kimi-K2.6')],
    pricing: perM('1.10', '6.50', '27.00'),
    limits: ctx('262,144 tokens'),
    trainingParams: null,
    matchAliases: ['Kimi K2.6'],
    events: [
      { kind: 'weights_available', occurredOn: '2026-04-20', title: 'Kimi K2.6:Advancing Open-Source Coding(开放权重)', sourceUrl: BLOG('kimi-k2-6') },
    ],
  },
  {
    provider: 'moonshot',
    officialId: 'kimi-k2.5',
    name: 'Kimi K2.5',
    kind: 'multimodal_understanding',
    stage: 'deprecated', // K3 发布后已停新注册用户,官方公告 2026-08-31 全平台下线
    availability: ['api', 'open_weights'],
    summary: '视觉 Agentic 智能:Agent、代码与视觉理解取得开源 SoTA,支持视觉与文本输入,256K 上下文',
    sources: [MODELS_PAGE, PRICING('chat-k25'), HF('Kimi-K2.5')],
    pricing: perM('0.70', '4.00', '21.00'),
    limits: ctx('262,144 tokens'),
    trainingParams: null, // 官方仅称「K3 参数规模约为 K2.5 的 3 倍」,未披露确切值
    matchAliases: ['Kimi K2.5'],
    events: [
      { kind: 'weights_available', occurredOn: '2026-01-27', title: 'Kimi K2.5:Visual Agentic Intelligence(开放权重)', sourceUrl: BLOG('kimi-k2-5') },
    ],
  },
  // ---- 已下线模型(models.md 已下线表;kimi-latest 为移动别名不另立)----
  {
    provider: 'moonshot',
    officialId: 'kimi-k2',
    name: 'Kimi K2',
    kind: 'text',
    stage: 'retired',
    availability: ['open_weights'], // API 渠道随下线清空(GLM-Z1 availability=[] 同口径);HF 权重仍可下载
    summary: '开源 Agentic 智能基座:1T 总参/32B 激活 MoE;0905 权重更新增强 Agentic Coding 并支持 256K 上下文;2026-05-25 下线',
    sources: [MODELS_PAGE, { title: 'Kimi K2 发布文章(Blog)', url: BLOG('kimi-k2') }, HF('Kimi-K2-Instruct')],
    pricing: null, // 已下线,平台不再刊价
    limits: null,
    trainingParams: { total: '1T', active: '32B' }, // 发布文章:「1 trillion total parameters, 32 billion activated」
    matchAliases: ['Kimi K2', 'Kimi-K2-Instruct-0905'],
    events: [
      { kind: 'weights_available', occurredOn: '2025-07-11', title: 'Kimi K2:Open Agentic Intelligence(开放权重)', sourceUrl: BLOG('kimi-k2') },
      { kind: 'updated', occurredOn: '2025-09-05', title: 'Kimi-K2-Instruct-0905:权重更新,增强 Agentic Coding、支持 256K 上下文', sourceUrl: 'https://huggingface.co/MoonshotAI/Kimi-K2-Instruct-0905' },
      { kind: 'retired', occurredOn: '2026-05-25', title: 'kimi-k2 系列模型下线', sourceUrl: MODELS_PAGE.url },
    ],
  },
  {
    provider: 'moonshot',
    officialId: 'kimi-k2-thinking',
    name: 'Kimi K2 Thinking',
    kind: 'text',
    stage: 'retired',
    availability: ['open_weights'], // 同 kimi-k2:API 下线清空,权重仍可下载
    summary: '开源思考模型:以思考 Agent 形式逐步推理,支持工具调用中的交错思考;2026-05-25 下线',
    sources: [MODELS_PAGE, { title: 'Kimi K2 Thinking 发布文章(Blog)', url: BLOG('kimi-k2-thinking') }, HF('Kimi-K2-Thinking')],
    pricing: null,
    limits: null,
    trainingParams: null,
    matchAliases: ['Kimi K2 Thinking'],
    events: [
      { kind: 'weights_available', occurredOn: '2025-11-06', title: 'Introducing Kimi K2 Thinking(开放权重)', sourceUrl: BLOG('kimi-k2-thinking') },
      { kind: 'retired', occurredOn: '2026-05-25', title: 'kimi-k2 系列模型下线', sourceUrl: MODELS_PAGE.url },
    ],
  },
  {
    provider: 'moonshot',
    officialId: 'kimi-thinking-preview',
    name: 'Kimi Thinking Preview',
    kind: 'text',
    stage: 'retired',
    availability: [], // API 专属模型,下线即无可访问渠道
    summary: '早期思考模型(预览);2025-11-11 下线,思考能力由 K2 系列接替',
    sources: [MODELS_PAGE],
    pricing: null,
    limits: null,
    trainingParams: null,
    matchAliases: ['Kimi Thinking Preview'],
    events: [
      { kind: 'retired', occurredOn: '2025-11-11', title: 'kimi-thinking-preview 下线', sourceUrl: MODELS_PAGE.url },
    ],
  },
  // ---- 生成模型 Moonshot V1(仅上下文档位有别;vision 变体种类不同独立成行)----
  {
    provider: 'moonshot',
    officialId: 'moonshot-v1',
    name: 'Moonshot V1',
    kind: 'text',
    stage: 'deprecated', // 已停新注册用户,官方公告 2026-08-31 全平台下线
    availability: ['api'],
    summary: '初代生成模型系列:8k/32k/128k 仅上下文长度有别、效果无差异;已停新用户,2026-08-31 全平台下线',
    sources: [MODELS_PAGE, PRICING('chat-v1')],
    pricing: perMTier(
      ['moonshot-v1-8k', '2.00', '10.00'],
      ['moonshot-v1-32k', '5.00', '20.00'],
      ['moonshot-v1-128k', '10.00', '30.00'],
    ),
    limits: [
      { label: '上下文窗口', text: '8,192 tokens', scope: 'moonshot-v1-8k' },
      { label: '上下文窗口', text: '32,768 tokens', scope: 'moonshot-v1-32k' },
      { label: '上下文窗口', text: '131,072 tokens', scope: 'moonshot-v1-128k' },
    ],
    trainingParams: null,
    matchAliases: ['Moonshot V1', 'moonshot-v1'],
  },
  {
    provider: 'moonshot',
    officialId: 'moonshot-v1-vision',
    name: 'Moonshot V1 Vision',
    kind: 'multimodal_understanding',
    stage: 'deprecated',
    availability: ['api'],
    summary: 'V1 系列视觉理解变体(理解图片内容输出文本,Preview);随系列 2026-08-31 下线',
    sources: [MODELS_PAGE, PRICING('chat-v1')],
    pricing: perMTier(
      ['moonshot-v1-8k-vision-preview', '2.00', '10.00'],
      ['moonshot-v1-32k-vision-preview', '5.00', '20.00'],
      ['moonshot-v1-128k-vision-preview', '10.00', '30.00'],
    ),
    limits: [
      { label: '上下文窗口', text: '8,192 tokens', scope: 'moonshot-v1-8k-vision-preview' },
      { label: '上下文窗口', text: '32,768 tokens', scope: 'moonshot-v1-32k-vision-preview' },
      { label: '上下文窗口', text: '131,072 tokens', scope: 'moonshot-v1-128k-vision-preview' },
    ],
    trainingParams: null,
    matchAliases: ['Moonshot V1 Vision', 'moonshot-v1-vision'],
  },
  // ---- 开放权重(官方仓库提供权重/实现与明确发布说明;不在商业 API)----
  {
    provider: 'moonshot',
    officialId: 'kimi-audio',
    name: 'Kimi-Audio',
    kind: 'audio_speech',
    stage: 'ga',
    availability: ['open_weights'], // 研究口径:不能因不在商业 Models API 而漏记,也不能反向标成 API 可用
    summary: '开源音频基础模型(7B):音频理解、生成与对话,官方仓库提供权重、实现与评测工具',
    sources: [
      { title: '官方仓库(GitHub MoonshotAI/Kimi-Audio)', url: 'https://github.com/MoonshotAI/Kimi-Audio' },
      HF('Kimi-Audio-7B'),
    ],
    pricing: null,
    limits: null,
    trainingParams: { total: '7B', active: null },
    matchAliases: ['Kimi-Audio', 'Kimi Audio'],
    events: [
      // Blog 索引卡片(2025-04-26)直链 GitHub 仓库,事件信源与卡片 URL 对齐(poll 去重键)
      { kind: 'weights_available', occurredOn: '2025-04-26', title: 'Kimi-Audio 开源发布', sourceUrl: 'https://github.com/MoonshotAI/Kimi-Audio' },
    ],
  },
]
