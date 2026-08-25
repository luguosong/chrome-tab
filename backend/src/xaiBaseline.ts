import type { ModelLimit, ModelPricing } from 'chrome-tab-shared'
import type { BaselineModel } from './modelTracking'

/**
 * xAI 人工核验基线(issues/05)。全部资料于 2026-08-25 自官方一手信源核对:
 * - 模型清单/价格/上下文/速率限额:模型目录 docs.x.ai/developers/models(Text API /
 *   Imagine / Voice 三张价格表即收录边界;表外无目录行的不臆造)与各模型文档页
 *   /developers/models/<id>(别名清单、Batch 支持度、区域均出自该页)
 * - 动态(上线月份):官方发布流 /developers/release-notes(仅月份标题粒度);首发
 *   精确日期取回链的官方发布文章 x.ai/news 的 datePublished
 * - Voice 能力明细(TTS/STT/S2S):Voice API 总览 /developers/model-capabilities/audio/voice
 * 归属与研究结论(research/sources.md §3/§4/§5):Grok 文本模型均「text, image → text」,
 * 图像输入是能力不是第二条记录(同 Anthropic 口径);xAI 无 embedding/rerank/审核
 * 专用模型,基线无对应行。TTS/STT 无官方模型 ID,按能力文档 slug 入行(官方价格表
 * 与发布流均以该名计价/宣告,GA 可证)。
 * ID 口径(研究 §5.2 + 模型目录 Model Aliases 节):无后缀/`-latest` 是**移动别名**
 * (grok-4.6-latest、grok-voice-latest 等,随版本迁移,不另立行);日期后缀
 * (-0309、-2026-03-02)是固定快照。Grok 4.20 家族当前只在固定快照 -0309 计价,
 * 固定 ID 即模型本体入档(区别于智谱「快照归并家族行」——那里家族行本身在售)。
 * 事件日期口径:官方文章给到日;发布流只给到月 → 锚定当月 1 日;文档页在售状态
 * 无日期(退役重定向、Deprecated 标注)→ 取核对日,标题注明依据。
 */

/** 平台/地区作用域(全部现价均为 xAI API 美元价)。 */
const API = 'xAI API(api.x.ai,美元)'
const CATALOG_PAGE = { title: '模型目录', url: 'https://docs.x.ai/developers/models' }
const RELEASES_PAGE = { title: '官方发布流', url: 'https://docs.x.ai/developers/release-notes.md' }
const DOC = (id: string) => ({ title: '模型文档页', url: `https://docs.x.ai/developers/models/${id}` })
const NEWS = (slug: string) => ({ title: '发布文章(x.ai)', url: `https://x.ai/news/${slug}` })
const VOICE_PAGE = { title: 'Voice API 总览', url: 'https://docs.x.ai/developers/model-capabilities/audio/voice' }

const price = (entries: ModelPricing['entries']): ModelPricing => ({ region: API, effectiveFrom: null, entries })
/** 按官方 prompt 长度档分档的百万 tokens 价(每档 = [作用域原文, 输入, 缓存输入, 输出];「请求内全部 tokens 按高档计费」为官方原文语义)。 */
const perMTiers = (...tiers: Array<[string, string, string, string]>): ModelPricing =>
  price(tiers.flatMap(([scope, input, cached, output]) => [
    { text: `输入 ${input} 美元/百万 tokens`, scope },
    { text: `缓存输入 ${cached} 美元/百万 tokens`, scope },
    { text: `输出 ${output} 美元/百万 tokens`, scope },
  ]))
/** 「上下文窗口」限额 + 速率限额对(目录/模型页 Rate limits 表口径);最大输出官方未列 → 不填。 */
const ctxRate = (context: string, rps: string, tpm: string): ModelLimit[] => [
  { label: '上下文窗口', text: context, scope: null },
  { label: '速率限制', text: `${rps} 请求/秒;${tpm} tokens/分钟`, scope: null },
]
/** 文本模型通用图像输入限额(模型目录 Additional Information 节,全系适用)。 */
const IMAGE_INPUT: ModelLimit = { label: '图像输入', text: '单图 ≤ 20MiB;jpg/png,数量不限', scope: null }

export const XAI_BASELINE: BaselineModel[] = [
  // ---- 文本(模型目录 Text API Pricing 表;全系「text, image → text」)----
  {
    provider: 'xai',
    officialId: 'grok-4.6',
    name: 'Grok 4.6',
    kind: 'text',
    stage: 'ga',
    availability: ['api'],
    summary: '前沿旗舰:编程、智能体与知识工作;推理力度可调(low/medium/high/xhigh),无文本输出上限',
    sources: [DOC('grok-4.6'), CATALOG_PAGE, NEWS('grok-4-6')],
    pricing: perMTiers(
      ['< 200k prompt tokens', '2', '0.50', '6'],
      ['≥ 200k prompt tokens', '4', '1.00', '12'],
    ),
    limits: [
      ...ctxRate('500K', '150', '50,000,000'),
      IMAGE_INPUT,
      { label: '最大输出', text: '无文本输出上限', scope: null },
    ],
    trainingParams: null, // 官方未披露(xAI 全系如此,研究 evaluations.md:不以推算补空)
    matchAliases: ['Grok 4.6', 'grok-4.6'],
    events: [
      { kind: 'api_available', occurredOn: '2026-08-12', title: 'Grok 4.6 上线 xAI API', sourceUrl: 'https://x.ai/news/grok-4-6' },
    ],
  },
  {
    provider: 'xai',
    officialId: 'grok-4.5',
    name: 'Grok 4.5',
    kind: 'text',
    stage: 'ga',
    availability: ['api'],
    summary: '编程与智能体工作流模型(孟菲斯自建数据中心训练);移动别名 grok-4.5-latest、grok-build-latest 指向本型号',
    sources: [DOC('grok-4.5'), CATALOG_PAGE, NEWS('grok-4-5')],
    pricing: perMTiers(
      ['< 200k prompt tokens', '2', '0.30', '6'],
      ['≥ 200k prompt tokens', '4', '0.60', '12'],
    ),
    limits: [...ctxRate('500K', '150', '50,000,000'), IMAGE_INPUT],
    trainingParams: null,
    matchAliases: ['Grok 4.5', 'grok-4.5'],
    events: [
      { kind: 'api_available', occurredOn: '2026-07-16', title: 'Grok 4.5 上线 xAI API', sourceUrl: 'https://x.ai/news/grok-4-5' },
    ],
  },
  {
    provider: 'xai',
    officialId: 'grok-4.3',
    name: 'Grok 4.3',
    kind: 'text',
    stage: 'ga',
    availability: ['api'],
    summary: '快速可靠,强工具调用与指令遵循;支持 Batch API(标准价八折),移动别名 grok-4.3-latest 指向本型号',
    sources: [DOC('grok-4.3'), CATALOG_PAGE],
    pricing: perMTiers(
      ['< 200k prompt tokens', '1.25', '0.20', '2.50'],
      ['≥ 200k prompt tokens', '2.50', '0.40', '5.00'],
    ),
    limits: [...ctxRate('1M', '37', '10,000,000'), IMAGE_INPUT],
    trainingParams: null,
    matchAliases: ['Grok 4.3', 'grok-4.3'],
  },
  {
    provider: 'xai',
    officialId: 'grok-build-0.1',
    name: 'Grok Build 0.1',
    kind: 'text',
    stage: 'experimental', // 官方发布流原文「Currently in early access」
    availability: ['api'],
    summary: '面向智能体编程工作流的编码模型(早期访问);承接退役型号 grok-code-fast 系列的别名路由',
    sources: [DOC('grok-build-0.1'), RELEASES_PAGE],
    pricing: perMTiers(
      ['< 200k prompt tokens', '1', '0.20', '2'],
      ['≥ 200k prompt tokens', '2', '0.40', '4'],
    ),
    limits: [...ctxRate('256K', '37', '10,000,000'), IMAGE_INPUT],
    trainingParams: null,
    matchAliases: ['Grok Build 0.1', 'grok-build-0.1'],
    events: [
      // 发布流 2026-05 段(月份粒度,锚定当月 1 日)
      { kind: 'api_available', occurredOn: '2026-05-01', title: 'Grok Build 0.1 进入早期访问(slug grok-build-0.1)', sourceUrl: RELEASES_PAGE.url },
    ],
  },
  {
    provider: 'xai',
    officialId: 'grok-4.20-0309-reasoning',
    name: 'Grok 4.20(Reasoning)',
    kind: 'text',
    stage: 'ga',
    availability: ['api'],
    summary: '高性能模型:市场最低幻觉率 + 严格提示遵循;移动别名 grok-4.20 现指向本固定快照,支持 Batch API(八折)',
    sources: [DOC('grok-4.20-0309-reasoning'), CATALOG_PAGE, RELEASES_PAGE],
    pricing: perMTiers(
      ['< 200k prompt tokens', '1.25', '0.20', '2.50'],
      ['≥ 200k prompt tokens', '2.50', '0.40', '5.00'],
    ),
    limits: [...ctxRate('1M', '37', '10,000,000'), IMAGE_INPUT],
    trainingParams: null,
    matchAliases: ['Grok 4.20', 'grok-4.20-0309-reasoning', 'grok-4.20-reasoning'],
    events: [
      // -0309 日期后缀即官方固定快照日(2026-03-09);发布流 2026-03 段宣告 live
      { kind: 'api_available', occurredOn: '2026-03-09', title: 'Grok 4.20 上线(固定快照 -0309)', sourceUrl: RELEASES_PAGE.url },
    ],
  },
  {
    provider: 'xai',
    officialId: 'grok-4.20-0309-non-reasoning',
    name: 'Grok 4.20(Non-Reasoning)',
    kind: 'text',
    stage: 'ga',
    availability: ['api'],
    summary: 'Grok 4.20 非推理模式固定快照(不支持 reasoning),支持 Batch API(八折)',
    sources: [DOC('grok-4.20-0309-non-reasoning'), CATALOG_PAGE],
    pricing: perMTiers(
      ['< 200k prompt tokens', '1.25', '0.20', '2.50'],
      ['≥ 200k prompt tokens', '2.50', '0.40', '5.00'],
    ),
    limits: [...ctxRate('1M', '37', '10,000,000'), IMAGE_INPUT],
    trainingParams: null,
    matchAliases: ['grok-4.20-0309-non-reasoning', 'grok-4.20-non-reasoning'],
    events: [
      { kind: 'api_available', occurredOn: '2026-03-09', title: 'Grok 4.20(Non-Reasoning)固定快照上线', sourceUrl: RELEASES_PAGE.url },
    ],
  },
  {
    provider: 'xai',
    officialId: 'grok-4.20-multi-agent-0309',
    name: 'Grok 4.20 Multi-Agent',
    kind: 'text',
    stage: 'beta', // 模型页标题「Grok 4.20 Multi-Agent Beta」
    availability: ['api'],
    summary: '多智能体并行协作的深度研究模型(Beta),支持 Batch API(八折)',
    sources: [DOC('grok-4.20-multi-agent-0309'), CATALOG_PAGE, RELEASES_PAGE],
    pricing: perMTiers(
      ['< 200k prompt tokens', '1.25', '0.20', '2.50'],
      ['≥ 200k prompt tokens', '2.50', '0.40', '5.00'],
    ),
    limits: [...ctxRate('1M', '37', '10,000,000'), IMAGE_INPUT],
    trainingParams: null,
    matchAliases: ['Grok 4.20 Multi-agent', 'grok-4.20-multi-agent-0309', 'grok-4.20-multi-agent'],
    events: [
      { kind: 'api_available', occurredOn: '2026-03-09', title: 'Grok 4.20 Multi-Agent 上线(Beta)', sourceUrl: RELEASES_PAGE.url },
    ],
  },
  {
    provider: 'xai',
    officialId: 'grok-code-fast-1',
    name: 'Grok Code Fast 1',
    kind: 'text',
    stage: 'retired',
    availability: [],
    summary: '已退役编码型号;其 ID(grok-code-fast-1 及 -0825 快照)现作为别名重定向至 Grok Build 0.1(模型页别名清单为证)',
    sources: [DOC('grok-build-0.1'), CATALOG_PAGE],
    pricing: null,
    limits: null,
    trainingParams: null,
    matchAliases: ['grok-code-fast-1', 'Grok Code Fast 1'],
    events: [
      // 退役重定向为在售文档页的无日期状态 → 取核对日(issues/05:退役重定向作为动态保留)
      { kind: 'retired', occurredOn: '2026-08-25', title: '退役,ID 重定向至 grok-build-0.1(模型页别名清单)', sourceUrl: DOC('grok-build-0.1').url },
    ],
  },
  // ---- 图像生成/编辑(模型目录 Imagine Pricing 表;全系「text, image → image」)----
  {
    provider: 'xai',
    officialId: 'grok-imagine-image-2.0',
    name: 'Grok Imagine Image 2.0',
    kind: 'image_generation',
    stage: 'ga',
    availability: ['api'],
    summary: '新一代图像生成/编辑旗舰(发布文章宣告 GA)',
    sources: [DOC('grok-imagine-image-2.0'), CATALOG_PAGE, NEWS('grok-imagine-image-2')],
    pricing: price([{ text: '$0.04 / image', scope: null }]),
    limits: [{ label: '速率限制', text: '6 请求/秒', scope: null }],
    trainingParams: null,
    matchAliases: ['Grok Imagine Image 2.0', 'grok-imagine-image-2.0'],
    events: [
      { kind: 'api_available', occurredOn: '2026-08-07', title: 'Grok Imagine Image 2.0 GA 上线', sourceUrl: 'https://x.ai/news/grok-imagine-image-2' },
    ],
  },
  {
    provider: 'xai',
    officialId: 'grok-imagine-image-quality',
    name: 'Grok Imagine Image Quality',
    kind: 'image_generation',
    stage: 'ga',
    availability: ['api'],
    summary: '高质量档图像生成变体(移动别名 grok-imagine-image-pro 亦指向本型号)',
    sources: [DOC('grok-imagine-image-quality'), CATALOG_PAGE],
    pricing: price([{ text: '$0.05 / image', scope: null }]),
    limits: [{ label: '速率限制', text: '6 请求/秒', scope: null }],
    trainingParams: null,
    matchAliases: ['grok-imagine-image-quality', 'grok-imagine-image-pro'],
  },
  {
    provider: 'xai',
    officialId: 'grok-imagine-image',
    name: 'Grok Imagine Image',
    kind: 'image_generation',
    stage: 'ga',
    availability: ['api'],
    summary: '图像生成/编辑;当前版本为固定快照 grok-imagine-image-2026-03-02(模型页别名清单)',
    sources: [DOC('grok-imagine-image'), CATALOG_PAGE],
    pricing: price([{ text: '$0.02 / image', scope: null }]),
    limits: [{ label: '速率限制', text: '6 请求/秒', scope: null }],
    trainingParams: null,
    matchAliases: ['grok-imagine-image'],
  },
  // ---- 视频生成/编辑(模型目录 Imagine Pricing 表)----
  {
    provider: 'xai',
    officialId: 'grok-imagine-video-1.5',
    name: 'Grok Imagine Video 1.5',
    kind: 'video_generation',
    stage: 'ga',
    availability: ['api'],
    summary: '视频生成/编辑:文生视频、图生视频、参考生视频(可配预设音色),T2V/I2V 原生 1080p;当前版本为固定快照 -2026-05-30',
    sources: [DOC('grok-imagine-video-1.5'), CATALOG_PAGE, RELEASES_PAGE],
    pricing: price([{ text: '$0.080 / second', scope: null }]),
    limits: [{ label: '速率限制', text: '10 请求/秒', scope: null }],
    trainingParams: null,
    matchAliases: ['grok-imagine-video-1.5', 'Grok Imagine Video 1.5'],
  },
  {
    provider: 'xai',
    officialId: 'grok-imagine-video',
    name: 'Grok Imagine Video',
    kind: 'video_generation',
    stage: 'ga',
    availability: ['api'],
    summary: '视频生成/编辑(text, image, video → video;文/图/视频输入)',
    sources: [DOC('grok-imagine-video'), CATALOG_PAGE],
    pricing: price([{ text: '$0.050 / second', scope: null }]),
    limits: [{ label: '速率限制', text: '10 请求/秒', scope: null }],
    trainingParams: null,
    matchAliases: ['grok-imagine-video'],
  },
  // ---- 音频/语音(模型目录 Voice Pricing 表 + Voice API 总览)----
  {
    provider: 'xai',
    officialId: 'grok-voice-think-fast-2.0',
    name: 'Grok Voice Think Fast 2.0',
    kind: 'audio_speech',
    stage: 'ga',
    availability: ['api'],
    summary: '实时语音到语音(speech-to-speech)模型;移动别名 grok-voice-latest 自 2026-08-05 起路由至本型号',
    sources: [DOC('grok-voice-think-fast-2.0'), VOICE_PAGE, CATALOG_PAGE, NEWS('grok-voice-think-fast-2')],
    pricing: price([
      { text: '音频 $0.08 / min($4.80 / hr)', scope: 'Speech to Speech' },
      { text: '$0.004 / text input(官方未标注 token 单位)', scope: 'Speech to Speech' },
    ]),
    limits: null,
    trainingParams: null,
    matchAliases: ['Grok Voice Think Fast 2.0', 'grok-voice-think-fast-2.0'],
    events: [
      { kind: 'api_available', occurredOn: '2026-07-29', title: 'Grok Voice Think Fast 2.0 上线(speech-to-speech)', sourceUrl: 'https://x.ai/news/grok-voice-think-fast-2' },
      // 别名换指向:官方发布流明文「grok-voice-latest will route to this model starting August 5, 2026」
      { kind: 'alias_repointed', occurredOn: '2026-08-05', title: '移动别名 grok-voice-latest 起路由至本型号', sourceUrl: RELEASES_PAGE.url },
    ],
  },
  {
    provider: 'xai',
    officialId: 'grok-voice-think-fast-1.0',
    name: 'Grok Voice Think Fast 1.0',
    kind: 'audio_speech',
    stage: 'deprecated', // 官方价格表该行标注「— Deprecated」(仍在售)
    availability: ['api'],
    summary: '上一代 speech-to-speech 模型(官方价格表标注 Deprecated,仍在售计价)',
    sources: [DOC('grok-voice-think-fast-1.0'), VOICE_PAGE, CATALOG_PAGE, NEWS('grok-voice-think-fast-1')],
    pricing: price([
      { text: '音频 $0.05 / min($3.00 / hr)', scope: 'Speech to Speech(Deprecated)' },
      { text: '$0.004 / text input(官方未标注 token 单位)', scope: 'Speech to Speech(Deprecated)' },
    ]),
    limits: null,
    trainingParams: null,
    matchAliases: ['Grok Voice Think Fast 1.0', 'grok-voice-think-fast-1.0'],
    events: [
      { kind: 'api_available', occurredOn: '2026-04-23', title: 'Grok Voice Think Fast 1.0 上线(speech-to-speech)', sourceUrl: 'https://x.ai/news/grok-voice-think-fast-1' },
      // 价格表 Deprecated 标注无日期 → 取核对日;原上线动态保留不改写(issues/05)
      { kind: 'deprecated', occurredOn: '2026-08-25', title: '官方价格表标注 Deprecated', sourceUrl: CATALOG_PAGE.url },
    ],
  },
  {
    provider: 'xai',
    officialId: 'speech-to-text',
    name: 'Speech to Text',
    kind: 'audio_speech',
    stage: 'ga',
    availability: ['api'],
    summary: '语音转文本(批量 + WebSocket 流式):25 语言、词级时间戳、多声道、说话人分离、Smart Turn 断句',
    sources: [VOICE_PAGE, RELEASES_PAGE],
    pricing: price([
      { text: '$0.10 / hr(REST 批量)', scope: 'Speech to Text' },
      { text: '$0.20 / hr(Streaming)', scope: 'Speech to Text' },
    ]),
    limits: null,
    trainingParams: null,
    matchAliases: ['Speech to Text', 'speech-to-text'],
    events: [
      // 发布流 2026-04 段宣告 GA(月份粒度,锚定当月 1 日)
      { kind: 'api_available', occurredOn: '2026-04-01', title: 'Speech to Text API 正式可用(GA)', sourceUrl: RELEASES_PAGE.url },
    ],
  },
  {
    provider: 'xai',
    officialId: 'text-to-speech',
    name: 'Text to Speech',
    kind: 'audio_speech',
    stage: 'ga',
    availability: ['api'],
    summary: '文本转语音:多内置音色 + 克隆音色、内联语音标签(笑声/低语/停顿),MP3 至电话 μ-law 输出',
    sources: [VOICE_PAGE, RELEASES_PAGE],
    pricing: price([{ text: '$15.00 / 1M chars', scope: 'Text to Speech' }]),
    limits: null,
    trainingParams: null,
    matchAliases: ['Text-to-Speech', 'text-to-speech', 'Text to Speech'],
    events: [
      // 发布流 2026-03 段宣告 GA(月份粒度,锚定当月 1 日)
      { kind: 'api_available', occurredOn: '2026-03-01', title: 'Text-to-Speech API 正式可用(GA)', sourceUrl: RELEASES_PAGE.url },
    ],
  },
]
