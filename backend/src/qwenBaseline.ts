import type { ModelEvent, ModelLimit, ModelPricing } from 'chrome-tab-shared'
import type { BaselineModel } from './modelTracking'

/**
 * 阿里通义(Qwen/万相)人工核验基线(issues/09)。全部资料于 2026-08-26 自官方一手信源核对:
 * - 模型上架日期与功能说明:百炼「模型上下架与更新」首表(华北2 北京,398 行;SSR 纯表格,
 *   2026-08-26 实抓对齐)——注意页面 10 张表 = 5 唯一表 × 2 拷贝(SSR+hydration),只取首表
 * - 现价/上下文/最大输出:各模型文档页 help.aliyun.com/zh/model-studio/<slug>(slug 规律
 *   点号→连字符;例外:qwen-vl-ocr → qwenvl-ocr)
 * - 开放权重归属与日期:HuggingFace 官方 Qwen org 实仓(API createdAt)
 *
 * 建模要点(grilling 2026-08-26 五裁定):
 * - **别名不立行**(CONTEXT.md「跟踪模型」Avoid,同 deepseek-chat 先例):qwen-plus /
 *   qwen-max / qwen-flash / qwen-turbo 四个无版本号 ID 是官方自证的滚动别名
 *   (qwen-max 2024-10-15 行原文「随着模型的升级,qwen-max将滚动更新升级」;
 *   qwen-plus-latest 行原文「动态更新版本,模型更新不会提前通知」),其快照链
 *   (1220→0112→2025-01-25→2025-04-28→07-14→07-28→09-11→12-01)作为所指代模型的历史
 *   留证;3.5 起带版本线(qwen3.5-plus…qwen3.8-max)是固定模型 ID,正常立行
 * - 开源家族按**代级行**归并(qwen3-open/qwen3.5-open/qwen3.6-open/qwen3-vl-open):
 *   同代多尺寸是一次发布的规格梯度,非独立产品差异(CONTEXT.md「跟踪模型」);
 *   AA slug 只映射旗舰尺寸。qwen3.8 双尺寸例外分行——2.4T-A95B(text)与 27B(原生
 *   视觉语言 Dense)种类不同不能同行
 * - 退役史暂缓:百炼首表无下架行,逐模型下线公告正文 JS 渲染 SSR 不可证(快照提前
 *   30 天/主线提前 3 个月的机制页可证),本票 stage 全按现役/preview 记;qwen-math 系
 *   官方退役线索(「预计维护到下个版本发布后一个月(待定)」)未立行,退役回填留后续票
 * - 品牌边界:qwq/qvq(Qwen with Questions,视觉/文本推理线)入档;tongyi-embedding /
 *   text-embedding-v4 / gte-rerank / cosyvoice / fun-asr / gui-plus / aitryon 等
 *   通义他线品牌不入(负例测试固定);wanx 应用类(poster/virtualmodel/x-painting 等
 *   应用 SKU 非模型型号)不入
 * - 精选口径:P0 核心 + P1 产品线全收,P2 收「现役且代表独立产品代际」者
 *   (qwen-vl-plus/max、wan 2.x 图像/视频旧线、qwen-coder-plus、qwen-long 等);
 *   character/voice-enrollment 等 SKU 与 2025-03 前 wanx 应用类不收
 */

/** 百炼「模型上下架与更新」(主发布源,研究 §3;首表 = 华北2 北京)。 */
export const QWEN_RELEASES_URL = 'https://help.aliyun.com/zh/model-studio/newly-released-models'

/** 百炼模型文档页(slug = 模型 ID 点号→连字符;例外显式传全 slug)。 */
const DOC = (id: string) => ({
  title: `百炼模型文档(${id})`,
  url: `https://help.aliyun.com/zh/model-studio/${id.replace(/\./g, '-')}`,
})
/** 开放权重信源(HuggingFace 官方 Qwen org 实仓)。 */
const HF = (repo: string) => ({
  title: `开放权重(HuggingFace Qwen/${repo})`,
  url: `https://huggingface.co/Qwen/${repo}`,
})

/** 文本类现价(百炼华北2 北京区,元/百万 tokens);extra 为缓存/思考档等附加原文行。 */
const textPrice = (input: string, output: string, extra: Array<{ text: string; scope: string | null }> = []): ModelPricing => ({
  region: '百炼平台(华北2 北京区,元/百万 tokens)',
  effectiveFrom: null,
  entries: [
    { text: `输入 ${input} 元/百万 tokens`, scope: null },
    { text: `输出 ${output} 元/百万 tokens`, scope: null },
    ...extra,
  ],
})
/** 上下文/最大输出限额(官方文档页「上下文限制」口径)。 */
const ctxLimits = (context: string, maxOut: string): ModelLimit[] => [
  { label: '上下文窗口', text: context, scope: null },
  { label: '最大输出', text: maxOut, scope: null },
]
/** 按图/按秒计价的媒体类现价(原文行直录)。 */
const mediaPrice = (region: string, entries: string[]): ModelPricing => ({
  region,
  effectiveFrom: null,
  entries: entries.map((text) => ({ text, scope: null })),
})
/** 主发布源事件(与 poll 自动解析同 sourceUrl,同键去重对齐)。 */
const rel = (kind: ModelEvent['kind'], occurredOn: string, title: string) => ({
  kind,
  occurredOn,
  title,
  sourceUrl: QWEN_RELEASES_URL,
})

export const QWEN_BASELINE: BaselineModel[] = [
  // ---- 文本:商业旗舰/主力线(带版本固定 ID;无版本别名不立行,见头注释)----
  {
    provider: 'alibaba',
    officialId: 'qwen3.8-max',
    name: 'Qwen3.8-Max',
    kind: 'text',
    stage: 'ga',
    availability: ['api'],
    summary: '2.4 万亿参数 MoE 旗舰,编程与办公能力全面跃升,可自主编程十数天交付完整项目;支持文本/深度思考/视觉理解',
    sources: [DOC('qwen3.8-max')],
    pricing: textPrice('12', '36', [
      { text: '输入(缓存命中)1.5 元/百万 tokens', scope: null },
      { text: '显式缓存创建 15 元、命中 1 元/百万 tokens', scope: null },
    ]),
    limits: [
      ...ctxLimits('1,000,000', '131,072'),
      { label: '上下文窗口', text: '983,616', scope: '思考模式' },
      { label: '思维链上限', text: '262,144', scope: '思考模式' },
    ],
    trainingParams: { total: '2.4万亿', active: null }, // 表格原文「2.4万亿参数MoE旗舰」,激活未披露
    matchAliases: ['qwen3.8-max'],
    events: [rel('api_available', '2026-08-02', 'Qwen3.8-Max 上线(2.4 万亿参数 MoE 旗舰)')],
  },
  {
    provider: 'alibaba',
    officialId: 'qwen3.7-max',
    name: 'Qwen3.7-Max',
    kind: 'text',
    stage: 'ga',
    availability: ['api'],
    summary: 'Qwen3.7 系列中规模最大的旗舰模型;2026-06-08 快照起增加视觉模态理解能力',
    sources: [DOC('qwen3.7-max')],
    pricing: textPrice('12', '36', [{ text: '输入(缓存命中)2.4 元/百万 tokens', scope: null }]),
    limits: ctxLimits('1,000,000', '131,072'),
    trainingParams: null,
    matchAliases: ['qwen3.7-max'],
    events: [
      rel('api_available', '2025-05-20', 'Qwen3.7-Max-Preview 上线'),
      rel('updated', '2025-05-21', 'Qwen3.7-Max 主线上线(preview 转正)'),
      rel('updated', '2026-06-09', '06-08 快照:增加视觉模态理解能力'),
    ],
  },
  {
    provider: 'alibaba',
    officialId: 'qwen3.6-max-preview',
    name: 'Qwen3.6-Max-Preview',
    kind: 'text',
    stage: 'preview',
    availability: ['api'],
    summary: 'Qwen3.6 旗舰预览版(表内无 GA 行);按输入长度阶梯计价',
    sources: [DOC('qwen3.6-max-preview')],
    pricing: textPrice('9', '54', [{ text: '输入 15、输出 90 元/百万 tokens', scope: '长输入档' }]),
    limits: ctxLimits('262,144', '65,536'),
    trainingParams: null,
    matchAliases: ['qwen3.6-max-preview'],
    events: [rel('api_available', '2026-04-20', 'Qwen3.6-Max-Preview 上线')],
  },
  {
    provider: 'alibaba',
    officialId: 'qwen3-max',
    name: 'Qwen3-Max',
    kind: 'text',
    stage: 'ga',
    availability: ['api'],
    summary: 'Qwen3 首个超万亿参数旗舰(官方口径),按输入长度三档阶梯计价',
    sources: [DOC('qwen3-max')],
    pricing: textPrice('2.5', '10', [
      { text: '输入 4、输出 16 元/百万 tokens', scope: '中输入档' },
      { text: '输入 7、输出 28 元/百万 tokens', scope: '长输入档' },
    ]),
    limits: [...ctxLimits('262,144', '65,536'), { label: '最大输出', text: '32,768', scope: '思考模式' }],
    trainingParams: null,
    matchAliases: ['qwen3-max'],
    events: [
      rel('api_available', '2025-09-05', 'Qwen3-Max-Preview 上线'),
      rel('updated', '2025-09-23', 'Qwen3-Max 主线上线(preview 转正)'),
      rel('updated', '2026-01-23', '2026-01-23 快照:能力大幅提升'),
    ],
  },
  {
    provider: 'alibaba',
    officialId: 'qwen3.7-plus',
    name: 'Qwen3.7-Plus',
    kind: 'text',
    stage: 'ga',
    availability: ['api'],
    summary: 'Qwen3.7 主力档模型,思考模式高档计价',
    sources: [DOC('qwen3.7-plus')],
    pricing: textPrice('2', '8', [{ text: '输入 6 元/百万 tokens', scope: '思考高档' }]),
    limits: ctxLimits('1,000,000', '131,072'),
    trainingParams: null,
    matchAliases: ['qwen3.7-plus'],
    events: [rel('api_available', '2026-06-01', 'Qwen3.7-Plus 上线')],
  },
  {
    provider: 'alibaba',
    officialId: 'qwen3.6-plus',
    name: 'Qwen3.6-Plus',
    kind: 'text',
    stage: 'ga',
    availability: ['api'],
    summary: 'Qwen3.6 主力档模型',
    sources: [DOC('qwen3.6-plus')],
    pricing: textPrice('2', '12', [{ text: '输入 8、输出 48 元/百万 tokens', scope: '高档' }]),
    limits: ctxLimits('1,000,000', '65,536'),
    trainingParams: null,
    matchAliases: ['qwen3.6-plus'],
    events: [rel('api_available', '2026-04-01', 'Qwen3.6-Plus 上线')],
  },
  {
    provider: 'alibaba',
    officialId: 'qwen3.5-plus',
    name: 'Qwen3.5-Plus',
    kind: 'text',
    stage: 'ga',
    availability: ['api'],
    summary: 'Qwen3.5 主力档模型',
    sources: [DOC('qwen3.5-plus')],
    pricing: textPrice('0.8', '4.8', [{ text: '输入 2、输出 12 元/百万 tokens', scope: '高档' }]),
    limits: ctxLimits('1,000,000', '65,536'),
    trainingParams: null,
    matchAliases: ['qwen3.5-plus'],
    events: [rel('api_available', '2026-02-15', 'Qwen3.5-Plus 上线')],
  },
  {
    provider: 'alibaba',
    officialId: 'qwen3.7-flash',
    name: 'Qwen3.7-Flash',
    kind: 'text',
    stage: 'ga',
    availability: ['api'],
    summary: 'Qwen3.7 高性价比档模型',
    sources: [DOC('qwen3.7-flash')],
    pricing: textPrice('0.2', '0.8', [{ text: '输入 0.6 元/百万 tokens', scope: '高档' }]),
    limits: ctxLimits('1,000,000', '131,072'),
    trainingParams: null,
    matchAliases: ['qwen3.7-flash'],
    events: [rel('api_available', '2026-07-21', 'Qwen3.7-Flash 上线')],
  },
  {
    provider: 'alibaba',
    officialId: 'qwen3.6-flash',
    name: 'Qwen3.6-Flash',
    kind: 'text',
    stage: 'ga',
    availability: ['api'],
    summary: 'Qwen3.6 高性价比档模型',
    sources: [DOC('qwen3.6-flash')],
    pricing: textPrice('1.2', '7.2', [{ text: '输入 4.8、输出 28.8 元/百万 tokens', scope: '高档' }]),
    limits: ctxLimits('1,000,000', '65,536'),
    trainingParams: null,
    matchAliases: ['qwen3.6-flash'],
    events: [rel('api_available', '2026-04-16', 'Qwen3.6-Flash 上线')],
  },
  {
    provider: 'alibaba',
    officialId: 'qwen3.5-flash',
    name: 'Qwen3.5-Flash',
    kind: 'text',
    stage: 'ga',
    availability: ['api'],
    summary: 'Qwen3.5 高性价比档模型',
    sources: [DOC('qwen3.5-flash')],
    pricing: textPrice('0.2', '2', [{ text: '输入 0.8、输出 8 元/百万 tokens', scope: '高档' }]),
    limits: ctxLimits('1,000,000', '65,536'),
    trainingParams: null,
    matchAliases: ['qwen3.5-flash'],
    events: [rel('api_available', '2026-02-23', 'Qwen3.5-Flash 上线')],
  },
  // ---- 文本:开源家族行(代级行,尺寸/变体归并)----
  {
    provider: 'alibaba',
    officialId: 'qwen3.8-2.4t-a95b',
    name: 'Qwen3.8-2.4T-A95B',
    kind: 'text',
    stage: 'ga',
    availability: ['api', 'open_weights'],
    summary: 'Qwen3.8 开源旗舰:总参数 2.4 万亿、每步激活约 950 亿的 MoE 模型(百炼与 max 同价)',
    sources: [DOC('qwen3.8-2.4t-a95b'), HF('Qwen3.8-2.4T-A95B')],
    pricing: textPrice('12', '36'),
    limits: ctxLimits('1,000,000', '131,072'),
    trainingParams: { total: '2.4万亿', active: '约950亿' }, // 表格原文直录
    matchAliases: ['qwen3.8-2.4t-a95b'],
    events: [
      { kind: 'weights_available', occurredOn: '2026-08-08', title: 'Qwen3.8-2.4T-A95B 开放权重发布(FP8 同日)', sourceUrl: HF('Qwen3.8-2.4T-A95B').url },
      rel('api_available', '2026-08-12', 'Qwen3.8-2.4T-A95B 百炼上架'),
    ],
  },
  {
    provider: 'alibaba',
    officialId: 'qwen3.8-27b',
    name: 'Qwen3.8-27B',
    kind: 'multimodal_understanding', // 原生视觉语言 Dense(与 2.4T 文本旗舰种类不同,故分行)
    stage: 'ga',
    availability: ['api', 'open_weights'],
    summary: 'Qwen3.8 系列 27B 原生视觉语言 Dense 模型',
    sources: [DOC('qwen3.8-27b'), HF('Qwen3.8-27B')],
    pricing: textPrice('3', '12'),
    limits: ctxLimits('1,000,000', '131,072'),
    trainingParams: null, // 尺寸在 ID 自明,官方未另列数
    matchAliases: ['qwen3.8-27b'],
    events: [
      { kind: 'weights_available', occurredOn: '2026-08-05', title: 'Qwen3.8-27B 开放权重发布', sourceUrl: HF('Qwen3.8-27B').url },
      rel('api_available', '2026-08-17', 'Qwen3.8-27B 百炼上架'),
    ],
  },
  {
    provider: 'alibaba',
    officialId: 'qwen3.6-open',
    name: 'Qwen3.6 开源系列',
    kind: 'text',
    stage: 'ga',
    availability: ['api', 'open_weights'],
    summary: 'Qwen3.6 开源代(27B Dense 与 35B-A3B MoE 两尺寸,同代发布归并一行)',
    sources: [DOC('qwen3.6-27b'), HF('Qwen3.6-35B-A3B'), HF('Qwen3.6-27B')],
    pricing: textPrice('1.8', '10.8', [{ text: '输入 3、输出 18 元/百万 tokens', scope: '27B 档' }]),
    limits: ctxLimits('262,144', '65,536'),
    trainingParams: null,
    matchAliases: ['qwen3.6-27b', 'qwen3.6-35b-a3b'],
    events: [
      { kind: 'weights_available', occurredOn: '2026-04-15', title: 'Qwen3.6-35B-A3B 开放权重发布', sourceUrl: HF('Qwen3.6-35B-A3B').url },
      rel('api_available', '2026-04-16', 'Qwen3.6-35B-A3B 百炼上架'),
      { kind: 'weights_available', occurredOn: '2026-04-21', title: 'Qwen3.6-27B 开放权重发布', sourceUrl: HF('Qwen3.6-27B').url },
      rel('api_available', '2026-04-22', 'Qwen3.6-27B 百炼上架'),
    ],
  },
  {
    provider: 'alibaba',
    officialId: 'qwen3.5-open',
    name: 'Qwen3.5 开源系列',
    kind: 'text',
    stage: 'ga',
    availability: ['api', 'open_weights'],
    summary: 'Qwen3.5 开源代(397B-A17B 旗舰与 122B-A10B/35B-A3B/27B 尺寸,同代归并一行;另有 0.8B~9B 档仅 HF 在档)',
    sources: [DOC('qwen3.5-397b-a17b'), HF('Qwen3.5-397B-A17B'), HF('Qwen3.5-122B-A10B')],
    pricing: textPrice('1.2', '7.2', [
      { text: '输入 3、输出 18 元/百万 tokens', scope: '397B 档思考模式' },
      { text: '输入 0.6、输出 4.8 元/百万 tokens', scope: '122B/35B 档' },
      { text: '输入 1.8、输出 14.4 元/百万 tokens', scope: '27B 档思考模式' },
    ]),
    limits: ctxLimits('262,144', '65,536'),
    trainingParams: null, // 各尺寸自明于 ID,官方未以单值披露
    matchAliases: ['qwen3.5-397b-a17b', 'qwen3.5-122b-a10b', 'qwen3.5-35b-a3b', 'qwen3.5-27b'],
    events: [
      { kind: 'weights_available', occurredOn: '2026-02-16', title: 'Qwen3.5-397B-A17B 开放权重发布', sourceUrl: HF('Qwen3.5-397B-A17B').url },
      rel('api_available', '2026-02-15', 'Qwen3.5-397B-A17B 百炼上架'),
      { kind: 'weights_available', occurredOn: '2026-02-24', title: 'Qwen3.5-122B-A10B/35B-A3B/27B 开放权重发布', sourceUrl: HF('Qwen3.5-122B-A10B').url },
      rel('api_available', '2026-02-23', 'Qwen3.5 其余尺寸百炼上架'),
    ],
  },
  {
    provider: 'alibaba',
    officialId: 'qwen3-next-80b-a3b',
    name: 'Qwen3-Next-80B-A3B',
    kind: 'text',
    stage: 'ga',
    availability: ['api', 'open_weights'],
    summary: 'Qwen3-Next 架构探索模型(80B 总参/A3B 激活),Instruct/Thinking 双模式同权重家族',
    sources: [DOC('qwen3-next-80b-a3b-instruct'), HF('Qwen3-Next-80B-A3B-Instruct'), HF('Qwen3-Next-80B-A3B-Thinking')],
    pricing: textPrice('1', '4'),
    limits: ctxLimits('131,072', '32,768'),
    trainingParams: null,
    matchAliases: ['qwen3-next-80b-a3b', 'qwen3-next-80b-a3b-instruct', 'qwen3-next-80b-a3b-thinking'],
    events: [
      { kind: 'weights_available', occurredOn: '2025-09-09', title: 'Qwen3-Next-80B-A3B 开放权重发布(Instruct/Thinking)', sourceUrl: HF('Qwen3-Next-80B-A3B-Instruct').url },
      rel('api_available', '2025-09-11', 'Qwen3-Next-80B-A3B 百炼上架'),
    ],
  },
  {
    provider: 'alibaba',
    officialId: 'qwen3-open',
    name: 'Qwen3 开源系列',
    kind: 'text',
    stage: 'ga',
    availability: ['api', 'open_weights'],
    summary: 'Qwen3 开源代(8B/14B/32B/30B-A3B/235B-A22B 五尺寸同日发布,2507 系快照随后;同代归并一行)',
    sources: [DOC('qwen3-235b-a22b-instruct'), HF('Qwen3-235B-A22B'), HF('Qwen3-32B')],
    pricing: textPrice('2', '8', [
      { text: '输出 20 元/百万 tokens', scope: '思考模式' },
    ]),
    limits: ctxLimits('131,072', '16,384'),
    trainingParams: null,
    matchAliases: ['qwen3-8b', 'qwen3-14b', 'qwen3-32b', 'qwen3-30b-a3b', 'qwen3-235b-a22b'],
    events: [
      { kind: 'weights_available', occurredOn: '2025-04-27', title: 'Qwen3 全系开放权重发布(8B~235B-A22B)', sourceUrl: HF('Qwen3-235B-A22B').url },
      rel('api_available', '2025-04-29', 'Qwen3 开源系百炼上架(五尺寸同日)'),
      rel('updated', '2025-07-21', '2507 系快照上架(能力升级)'),
    ],
  },
  // ---- 文本:编程/翻译/长文本/推理专项 ----
  {
    provider: 'alibaba',
    officialId: 'qwen3-coder-plus',
    name: 'Qwen3-Coder-Plus',
    kind: 'text',
    stage: 'ga',
    availability: ['api', 'open_weights'], // 开源对应 Qwen3-Coder-480B-A35B-Instruct(同日发布,同源模型)
    summary: 'Qwen3-Coder 旗舰编程模型;≤32K 与长输入两档计价',
    sources: [DOC('qwen3-coder-plus'), HF('Qwen3-Coder-480B-A35B-Instruct')],
    pricing: textPrice('4', '16', [{ text: '输入 6、输出 24 元/百万 tokens', scope: '长输入档' }]),
    limits: ctxLimits('1,000,000', '65,536'),
    trainingParams: null,
    matchAliases: ['qwen3-coder-plus', 'qwen3-coder-480b-a35b-instruct'],
    events: [
      { kind: 'weights_available', occurredOn: '2025-07-22', title: 'Qwen3-Coder-480B-A35B 开放权重发布', sourceUrl: HF('Qwen3-Coder-480B-A35B-Instruct').url },
      rel('api_available', '2025-07-22', 'Qwen3-Coder-Plus 上线'),
      rel('updated', '2025-09-23', '09-23 快照上架'),
    ],
  },
  {
    provider: 'alibaba',
    officialId: 'qwen3-coder-flash',
    name: 'Qwen3-Coder-Flash',
    kind: 'text',
    stage: 'ga',
    availability: ['api', 'open_weights'], // 开源对应 Qwen3-Coder-30B-A3B-Instruct
    summary: 'Qwen3-Coder 高性价比档编程模型',
    sources: [DOC('qwen3-coder-flash'), HF('Qwen3-Coder-30B-A3B-Instruct')],
    pricing: textPrice('1', '4', [{ text: '输入 1.5、输出 6 元/百万 tokens', scope: '长输入档' }]),
    limits: ctxLimits('1,000,000', '65,536'),
    trainingParams: null,
    matchAliases: ['qwen3-coder-flash', 'qwen3-coder-30b-a3b-instruct'],
    events: [
      { kind: 'weights_available', occurredOn: '2025-07-31', title: 'Qwen3-Coder-30B-A3B 开放权重发布', sourceUrl: HF('Qwen3-Coder-30B-A3B-Instruct').url },
      rel('api_available', '2025-08-05', 'Qwen3-Coder-Flash 上线'),
    ],
  },
  {
    provider: 'alibaba',
    officialId: 'qwen3-coder-next',
    name: 'Qwen3-Coder-Next',
    kind: 'text',
    stage: 'ga',
    availability: ['api', 'open_weights'],
    summary: 'Qwen3-Coder 下一代架构模型(Next 系,含 Base 底座),按输入长度三档阶梯计价',
    sources: [DOC('qwen3-coder-next'), HF('Qwen3-Coder-Next')],
    pricing: textPrice('1', '4', [
      { text: '输入 1.5、输出 6 元/百万 tokens', scope: '中输入档' },
      { text: '输入 2.5、输出 10 元/百万 tokens', scope: '长输入档' },
    ]),
    limits: ctxLimits('262,144', '65,536'),
    trainingParams: null,
    matchAliases: ['qwen3-coder-next'],
    events: [
      { kind: 'weights_available', occurredOn: '2026-01-30', title: 'Qwen3-Coder-Next 开放权重发布(Base 02-01)', sourceUrl: HF('Qwen3-Coder-Next').url },
      rel('api_available', '2026-02-19', 'Qwen3-Coder-Next 百炼上架'),
    ],
  },
  {
    provider: 'alibaba',
    officialId: 'qwen-coder-plus',
    name: 'Qwen-Coder-Plus',
    kind: 'text',
    stage: 'ga',
    availability: ['api'],
    summary: 'Qwen2.5 代编程主线(qwen-coder-turbo 2024-09-19 首上架,11-12 升级 plus 命名);旧线现役',
    sources: [DOC('qwen-coder-plus')],
    pricing: textPrice('3.5', '7'),
    limits: ctxLimits('131,072', '8,192'),
    trainingParams: null,
    matchAliases: ['qwen-coder-plus', 'qwen-coder-turbo'],
    events: [
      rel('api_available', '2024-09-19', 'qwen-coder-turbo 上线(2.5 代编程线起点)'),
      rel('updated', '2024-11-12', '升级 Qwen-Coder-Plus'),
    ],
  },
  {
    provider: 'alibaba',
    officialId: 'qwen-mt-plus',
    name: 'Qwen-MT-Plus',
    kind: 'text',
    stage: 'ga',
    availability: ['api'],
    summary: '翻译专项模型线主力档(turbo/flash/lite 各档同线归并)',
    sources: [DOC('qwen-mt-plus')],
    pricing: textPrice('1.8', '5.4'),
    limits: ctxLimits('16,384', '8,192'),
    trainingParams: null,
    matchAliases: ['qwen-mt-plus', 'qwen-mt-turbo', 'qwen-mt-flash', 'qwen-mt-lite'],
    events: [
      rel('api_available', '2025-07-22', 'Qwen-MT 翻译线上线(plus/turbo)'),
      rel('updated', '2025-11-06', 'qwen-mt-flash 上线'),
      rel('updated', '2025-11-19', 'qwen-mt-lite 上线'),
    ],
  },
  {
    provider: 'alibaba',
    officialId: 'qwen-long',
    name: 'Qwen-Long',
    kind: 'text',
    stage: 'ga',
    availability: ['api'],
    summary: '长文档专项模型,10M tokens 上下文(全线上最大),Batch 五折',
    sources: [DOC('qwen-long')],
    pricing: textPrice('0.5', '2', [{ text: 'Batch 输入 0.25、输出 1 元/百万 tokens', scope: null }]),
    limits: ctxLimits('10,000,000', '8,192'),
    trainingParams: null,
    matchAliases: ['qwen-long'],
    events: [
      rel('api_available', '2024-05-20', 'Qwen-Long 上线'),
      rel('updated', '2025-03-19', 'latest+0125 快照上架'),
    ],
  },
  {
    provider: 'alibaba',
    officialId: 'qwen-deep-research',
    name: 'Qwen-Deep-Research',
    kind: 'text',
    stage: 'ga',
    availability: ['api'],
    summary: '深度研究智能体模型(2025-12-15 快照 2026-03-23 上表升级)',
    sources: [DOC('qwen-deep-research')],
    pricing: textPrice('54', '163'),
    limits: ctxLimits('1,000,000', '32,768'),
    trainingParams: null,
    matchAliases: ['qwen-deep-research'],
    events: [
      rel('api_available', '2025-08-22', 'Qwen-Deep-Research 上线'),
      rel('updated', '2026-03-23', '2025-12-15 快照上架'),
    ],
  },
  {
    provider: 'alibaba',
    officialId: 'qwq-plus',
    name: 'QwQ-Plus',
    kind: 'text',
    stage: 'ga',
    availability: ['api'],
    summary: 'QwQ 推理线 API 主力(基于 Qwen2.5 训练,强化学习提升推理;开源对应 QwQ-32B)',
    sources: [DOC('qwq-plus')],
    pricing: textPrice('1.6', '4', [{ text: 'Batch 输入 0.8、输出 2 元/百万 tokens', scope: null }]),
    limits: ctxLimits('131,072', '8,192'),
    trainingParams: null,
    matchAliases: ['qwq-plus'],
    events: [rel('api_available', '2025-03-05', 'QwQ-Plus 上线(QwQ 推理线)')],
  },
  {
    provider: 'alibaba',
    officialId: 'qvq-max',
    name: 'QVQ-Max',
    kind: 'multimodal_understanding',
    stage: 'ga',
    availability: ['api'],
    summary: '千问 QVQ 视觉推理模型(视觉输入+思维链输出,数学/编程/视觉分析);2025-06-03 增强版 qvq-plus 归并本行',
    sources: [DOC('qvq-max')],
    pricing: textPrice('8', '32'),
    limits: ctxLimits('131,072', '8,192'),
    trainingParams: null,
    matchAliases: ['qvq-max', 'qvq-plus'],
    events: [
      rel('api_available', '2025-03-26', 'QVQ-Max 上线(视觉推理线)'),
      rel('updated', '2025-06-03', 'QVQ 增强版(qvq-plus)上线'),
    ],
  },
  // ---- 视觉理解(VL/OCR)----
  {
    provider: 'alibaba',
    officialId: 'qwen3-vl-plus',
    name: 'Qwen3-VL-Plus',
    kind: 'multimodal_understanding',
    stage: 'ga',
    availability: ['api'],
    summary: 'Qwen3-VL 视觉理解主力档',
    sources: [DOC('qwen3-vl-plus')],
    pricing: textPrice('1', '10', [{ text: '输入 1.5 元/百万 tokens', scope: '高档' }]),
    limits: ctxLimits('262,144', '32,768'),
    trainingParams: null,
    matchAliases: ['qwen3-vl-plus'],
    events: [rel('api_available', '2026-01-26', 'Qwen3-VL-Plus 上线')],
  },
  {
    provider: 'alibaba',
    officialId: 'qwen3-vl-flash',
    name: 'Qwen3-VL-Flash',
    kind: 'multimodal_understanding',
    stage: 'ga',
    availability: ['api'],
    summary: 'Qwen3-VL 高性价比档',
    sources: [DOC('qwen3-vl-flash')],
    pricing: textPrice('0.15', '1.5', [{ text: '输入 0.3 元/百万 tokens', scope: '高档' }]),
    limits: ctxLimits('262,144', '32,768'),
    trainingParams: null,
    matchAliases: ['qwen3-vl-flash'],
    events: [rel('api_available', '2026-01-22', 'Qwen3-VL-Flash 上线')],
  },
  {
    provider: 'alibaba',
    officialId: 'qwen3-vl-open',
    name: 'Qwen3-VL 开源系列',
    kind: 'multimodal_understanding',
    stage: 'ga',
    availability: ['api', 'open_weights'],
    summary: 'Qwen3-VL 开源代(235B-A22B/32B/30B-A3B/8B 四尺寸,Instruct/Thinking 双模式同权重家族)',
    sources: [DOC('qwen3-vl-235b-a22b-instruct'), HF('Qwen3-VL-235B-A22B-Instruct'), HF('Qwen3-VL-32B-Instruct')],
    pricing: textPrice('2', '8'),
    limits: ctxLimits('131,072', '32,768'),
    trainingParams: null,
    matchAliases: ['qwen3-vl-235b-a22b-instruct', 'qwen3-vl-32b-instruct', 'qwen3-vl-30b-a3b-instruct', 'qwen3-vl-8b-instruct'],
    events: [
      { kind: 'weights_available', occurredOn: '2025-09-22', title: 'Qwen3-VL-235B-A22B 开放权重发布', sourceUrl: HF('Qwen3-VL-235B-A22B-Instruct').url },
      rel('api_available', '2025-09-23', 'Qwen3-VL 开源系百炼上架(235B 首)'),
      rel('updated', '2025-10-21', '32B 档上架(30B-A3B/8B 先后随上)'),
    ],
  },
  {
    provider: 'alibaba',
    officialId: 'qwen-vl-ocr',
    name: 'Qwen-VL-OCR',
    kind: 'multimodal_understanding',
    stage: 'ga',
    availability: ['api'],
    summary: 'OCR 专项视觉模型(文档/截图文字识别);1028→2025-04-13→08-28 快照原地升级链',
    sources: [{ title: '百炼模型文档(qwenvl-ocr)', url: 'https://help.aliyun.com/zh/model-studio/qwenvl-ocr' }], // 官方 slug 例外:无连字符
    pricing: textPrice('0.3', '0.5'),
    limits: ctxLimits('38,192', '8,192'),
    trainingParams: null,
    matchAliases: ['qwen-vl-ocr'],
    events: [
      rel('api_available', '2024-11-14', 'qwen-vl-ocr-1028 上线'),
      rel('updated', '2025-04-13', 'qwen-vl-ocr-2025-04-13 快照'),
      rel('updated', '2025-08-28', 'qwen-vl-ocr-2025-08-28 快照'),
      rel('updated', '2025-11-20', 'qwen-vl-ocr 主线命名(去日期快照化)'),
    ],
  },
  {
    provider: 'alibaba',
    officialId: 'qwen3.5-ocr',
    name: 'Qwen3.5-OCR',
    kind: 'multimodal_understanding',
    stage: 'ga',
    availability: ['api'],
    summary: 'Qwen3.5 代 OCR 专项模型',
    sources: [DOC('qwen3.5-ocr')],
    pricing: textPrice('0.5', '2'),
    limits: ctxLimits('65,536', '16,384'),
    trainingParams: null,
    matchAliases: ['qwen3.5-ocr'],
    events: [rel('api_available', '2026-06-16', 'Qwen3.5-OCR 上线')],
  },
  {
    provider: 'alibaba',
    officialId: 'qwen-vl-plus',
    name: 'Qwen-VL-Plus',
    kind: 'multimodal_understanding',
    stage: 'ga',
    availability: ['api'],
    summary: 'Qwen2.5 代视觉理解主力档(旧线现役)',
    sources: [DOC('qwen-vl-plus')],
    pricing: textPrice('0.8', '2'),
    limits: ctxLimits('131,072', '8,192'),
    trainingParams: null,
    matchAliases: ['qwen-vl-plus'],
    events: [rel('api_available', '2025-06-13', 'Qwen-VL-Plus 上线')],
  },
  {
    provider: 'alibaba',
    officialId: 'qwen-vl-max',
    name: 'Qwen-VL-Max',
    kind: 'multimodal_understanding',
    stage: 'ga',
    availability: ['api'],
    summary: 'Qwen2.5 代视觉理解旗舰档(旧线现役)',
    sources: [DOC('qwen-vl-max')],
    pricing: textPrice('1.6', '4'),
    limits: ctxLimits('131,072', '8,192'),
    trainingParams: null,
    matchAliases: ['qwen-vl-max'],
    events: [rel('api_available', '2025-05-26', 'Qwen-VL-Max 上线')],
  },
  // ---- 全模态(Omni)----
  {
    provider: 'alibaba',
    officialId: 'qwen3.5-omni-plus',
    name: 'Qwen3.5-Omni-Plus',
    kind: 'audio_speech',
    stage: 'ga',
    availability: ['api'],
    summary: 'Qwen3.5 全模态主力档(文本/音频/图像/视频输入,文本与语音输出)',
    sources: [DOC('qwen3.5-omni-plus')],
    pricing: {
      region: '百炼平台(华北2 北京区,元/百万 tokens)',
      effectiveFrom: null,
      entries: [
        { text: '音频输入 53 元/百万 tokens', scope: null },
        { text: '文本/图像/视频输入 7 元/百万 tokens', scope: null },
        { text: '文本输出 40 元/百万 tokens', scope: null },
        { text: '文本+音频输出 213 元/百万 tokens', scope: null },
      ],
    },
    limits: ctxLimits('262,144', '65,536'),
    trainingParams: null,
    matchAliases: ['qwen3.5-omni-plus'],
    events: [rel('api_available', '2026-03-30', 'Qwen3.5-Omni-Plus 上线(03-15 快照先行)')],
  },
  {
    provider: 'alibaba',
    officialId: 'qwen3.5-omni-flash',
    name: 'Qwen3.5-Omni-Flash',
    kind: 'audio_speech',
    stage: 'ga',
    availability: ['api'],
    summary: 'Qwen3.5 全模态高性价比档',
    sources: [DOC('qwen3.5-omni-flash')],
    pricing: {
      region: '百炼平台(华北2 北京区,元/百万 tokens)',
      effectiveFrom: null,
      entries: [
        { text: '音频输入 18 元/百万 tokens', scope: null },
        { text: '文本/图像/视频输入 2.2 元/百万 tokens', scope: null },
        { text: '文本输出 13.3 元/百万 tokens', scope: null },
        { text: '文本+音频输出 72 元/百万 tokens', scope: null },
      ],
    },
    limits: ctxLimits('262,144', '65,536'),
    trainingParams: null,
    matchAliases: ['qwen3.5-omni-flash'],
    events: [rel('api_available', '2026-03-30', 'Qwen3.5-Omni-Flash 上线(03-15 快照先行)')],
  },
  {
    provider: 'alibaba',
    officialId: 'qwen3-omni-flash',
    name: 'Qwen3-Omni-Flash',
    kind: 'audio_speech',
    stage: 'ga',
    availability: ['api', 'open_weights'], // 开源对应 Qwen3-Omni-30B-A3B(Instruct/Thinking/Captioner)
    summary: 'Qwen3 全模态高性价比档(realtime 形态同格;开源 30B-A3B 系在档)',
    sources: [DOC('qwen3-omni-flash'), HF('Qwen3-Omni-30B-A3B-Instruct')],
    pricing: {
      region: '百炼平台(华北2 北京区,元/百万 tokens)',
      effectiveFrom: null,
      entries: [
        { text: '文本输入 1.8、音频输入 15.8、图像/视频输入 3.3 元/百万 tokens', scope: null },
        { text: '文本输出 6.9 元/百万 tokens(纯文本输入时)', scope: null },
        { text: '文本输出 12.7 元/百万 tokens(含多模态输入时)', scope: null },
        { text: '文本+音频输出 62.6 元/百万 tokens', scope: null },
      ],
    },
    limits: ctxLimits('65,536', '16,384'),
    trainingParams: null,
    matchAliases: ['qwen3-omni-flash'],
    events: [
      { kind: 'weights_available', occurredOn: '2025-09-15', title: 'Qwen3-Omni-30B-A3B 开放权重发布', sourceUrl: HF('Qwen3-Omni-30B-A3B-Instruct').url },
      rel('api_available', '2025-12-04', 'Qwen3-Omni-Flash 上线(12-01 快照先行)'),
    ],
  },
  {
    provider: 'alibaba',
    officialId: 'qwen-omni-turbo',
    name: 'Qwen-Omni-Turbo',
    kind: 'audio_speech',
    stage: 'ga',
    availability: ['api'],
    summary: 'Qwen2.5 代全模态档(旧线现役,realtime 形态同线)',
    sources: [DOC('qwen-omni-turbo')],
    pricing: {
      region: '百炼平台(华北2 北京区,元/百万 tokens)',
      effectiveFrom: null,
      entries: [
        { text: '文本输入 0.4、音频输入 25、图像/视频输入 1.5 元/百万 tokens', scope: null },
        { text: '文本输出 1.6~4.5 元/百万 tokens', scope: null },
        { text: '文本+音频输出 50 元/百万 tokens', scope: null },
      ],
    },
    limits: ctxLimits('32,768', '2,048'),
    trainingParams: null,
    matchAliases: ['qwen-omni-turbo'],
    events: [rel('api_available', '2025-02-14', 'Qwen-Omni-Turbo 上线')],
  },
  // ---- 语音识别/实时同传 ----
  {
    provider: 'alibaba',
    officialId: 'qwen-audio-3.0-asr-flash',
    name: 'Qwen-Audio-3.0-ASR-Flash',
    kind: 'audio_speech',
    stage: 'ga',
    availability: ['api'],
    summary: 'Qwen-Audio 3.0 语音识别档(streaming/filetrans 两种调用形态同模型)',
    sources: [DOC('qwen-audio-3.0-asr-flash')],
    pricing: mediaPrice('百炼平台(华北2 北京区)', ['音频时长 0.00022 元/秒']),
    limits: null,
    trainingParams: null,
    matchAliases: ['qwen-audio-3.0-asr-flash', 'qwen-audio-3.0-asr-flash-streaming', 'qwen-audio-3.0-asr-flash-filetrans'],
    events: [rel('api_available', '2026-07-30', 'Qwen-Audio-3.0-ASR-Flash 上线(三调用形态)')],
  },
  {
    provider: 'alibaba',
    officialId: 'qwen3-asr-flash',
    name: 'Qwen3-ASR-Flash',
    kind: 'audio_speech',
    stage: 'ga',
    availability: ['api', 'open_weights'], // 开源对应 Qwen3-ASR-0.6B/1.7B
    summary: 'Qwen3 语音识别档(realtime/filetrans 形态同线;2026-02-10 快照升级)',
    sources: [DOC('qwen3-asr-flash'), HF('Qwen3-ASR-0.6B')],
    pricing: mediaPrice('百炼平台(华北2 北京区)', ['音频时长 0.00022 元/秒']),
    limits: null,
    trainingParams: null,
    matchAliases: ['qwen3-asr-flash'],
    events: [
      rel('api_available', '2025-09-08', 'Qwen3-ASR-Flash 上线'),
      { kind: 'weights_available', occurredOn: '2026-01-28', title: 'Qwen3-ASR-0.6B/1.7B 开放权重发布', sourceUrl: HF('Qwen3-ASR-0.6B').url },
      rel('updated', '2026-02-10', '快照升级'),
    ],
  },
  {
    provider: 'alibaba',
    officialId: 'qwen3.5-livetranslate-flash-realtime',
    name: 'Qwen3.5-LiveTranslate-Flash-Realtime',
    kind: 'audio_speech',
    stage: 'ga',
    availability: ['api'],
    summary: 'Qwen3.5 实时语音翻译档(音/图/文输入,文/音频输出)',
    sources: [DOC('qwen3.5-livetranslate-flash-realtime')],
    pricing: {
      region: '百炼平台(华北2 北京区,元/百万 tokens)',
      effectiveFrom: null,
      entries: [
        { text: '音频输入 40、图片输入 3.3 元/百万 tokens', scope: null },
        { text: '文本输出 100 元/百万 tokens', scope: null },
        { text: '音频输出 160 元/百万 tokens', scope: null },
      ],
    },
    limits: [{ label: '上下文窗口', text: '53,248', scope: null }],
    trainingParams: null,
    matchAliases: ['qwen3.5-livetranslate-flash-realtime'],
    events: [rel('api_available', '2026-05-19', 'Qwen3.5-LiveTranslate-Flash-Realtime 上线')],
  },
  // ---- 语音合成(TTS)----
  {
    provider: 'alibaba',
    officialId: 'qwen-audio-3.0-tts-plus',
    name: 'Qwen-Audio-3.0-TTS-Plus',
    kind: 'audio_speech',
    stage: 'ga',
    availability: ['api'],
    summary: 'Qwen-Audio 3.0 语音合成主力档',
    sources: [DOC('qwen-audio-3.0-tts-plus')],
    pricing: mediaPrice('百炼平台(华北2 北京区)', ['语音合成 1.4 元/万字符']),
    limits: null,
    trainingParams: null,
    matchAliases: ['qwen-audio-3.0-tts-plus'],
    events: [rel('api_available', '2026-07-14', 'Qwen-Audio-3.0-TTS 系上线(plus/flash)')],
  },
  {
    provider: 'alibaba',
    officialId: 'qwen-audio-3.0-tts-flash',
    name: 'Qwen-Audio-3.0-TTS-Flash',
    kind: 'audio_speech',
    stage: 'ga',
    availability: ['api'],
    summary: 'Qwen-Audio 3.0 语音合成高性价比档',
    sources: [DOC('qwen-audio-3.0-tts-flash')],
    pricing: mediaPrice('百炼平台(华北2 北京区)', ['语音合成 1 元/万字符']),
    limits: null,
    trainingParams: null,
    matchAliases: ['qwen-audio-3.0-tts-flash'],
    events: [rel('api_available', '2026-07-14', 'Qwen-Audio-3.0-TTS 系上线(plus/flash)')],
  },
  {
    provider: 'alibaba',
    officialId: 'qwen-audio-3.0-realtime-plus',
    name: 'Qwen-Audio-3.0-Realtime-Plus',
    kind: 'audio_speech',
    stage: 'ga',
    availability: ['api'],
    summary: 'Qwen-Audio 3.0 实时语音对话主力档',
    sources: [DOC('qwen-audio-3.0-realtime-plus')],
    pricing: {
      region: '百炼平台(华北2 北京区,元/百万 tokens)',
      effectiveFrom: null,
      entries: [
        { text: '音频输入 40、文本输入 5 元/百万 tokens', scope: null },
        { text: '文本输出 40 元/百万 tokens', scope: null },
        { text: '文本+音频输出 150 元/百万 tokens', scope: null },
      ],
    },
    limits: null,
    trainingParams: null,
    matchAliases: ['qwen-audio-3.0-realtime-plus'],
    events: [rel('api_available', '2026-07-14', 'Qwen-Audio-3.0-Realtime 系上线(plus/flash)')],
  },
  {
    provider: 'alibaba',
    officialId: 'qwen-audio-3.0-realtime-flash',
    name: 'Qwen-Audio-3.0-Realtime-Flash',
    kind: 'audio_speech',
    stage: 'ga',
    availability: ['api'],
    summary: 'Qwen-Audio 3.0 实时语音对话高性价比档',
    sources: [DOC('qwen-audio-3.0-realtime-flash')],
    pricing: {
      region: '百炼平台(华北2 北京区,元/百万 tokens)',
      effectiveFrom: null,
      entries: [
        { text: '音频输入 30、文本输入 3 元/百万 tokens', scope: null },
        { text: '文本输出 30 元/百万 tokens', scope: null },
        { text: '文本+音频输出 100 元/百万 tokens', scope: null },
      ],
    },
    limits: null,
    trainingParams: null,
    matchAliases: ['qwen-audio-3.0-realtime-flash'],
    events: [rel('api_available', '2026-07-14', 'Qwen-Audio-3.0-Realtime 系上线(plus/flash)')],
  },
  {
    provider: 'alibaba',
    officialId: 'qwen3-tts-flash',
    name: 'Qwen3-TTS-Flash',
    kind: 'audio_speech',
    stage: 'ga',
    availability: ['api', 'open_weights'], // 开源对应 Qwen3-TTS-12Hz-0.6B/1.7B-Base
    summary: 'Qwen3 语音合成档(realtime 形态同格;开源 12Hz Base 系在档)',
    sources: [DOC('qwen3-tts-flash'), HF('Qwen3-TTS-12Hz-0.6B-Base')],
    pricing: mediaPrice('百炼平台(华北2 北京区)', ['语音合成 0.8 元/万字符']),
    limits: null,
    trainingParams: null,
    matchAliases: ['qwen3-tts-flash'],
    events: [
      rel('api_available', '2025-11-27', 'Qwen3-TTS-Flash 上线'),
      { kind: 'weights_available', occurredOn: '2026-01-21', title: 'Qwen3-TTS-12Hz Base 系开放权重发布', sourceUrl: HF('Qwen3-TTS-12Hz-0.6B-Base').url },
    ],
  },
  {
    provider: 'alibaba',
    officialId: 'qwen3-tts-instruct-flash',
    name: 'Qwen3-TTS-Instruct-Flash',
    kind: 'audio_speech',
    stage: 'ga',
    availability: ['api', 'open_weights'], // 开源对应 Qwen3-TTS-12Hz-*-CustomVoice
    summary: 'Qwen3 指令跟随语音合成档(自然语言控制语气/情感/语速)',
    sources: [DOC('qwen3-tts-instruct-flash'), HF('Qwen3-TTS-12Hz-1.7B-CustomVoice')],
    pricing: mediaPrice('百炼平台(华北2 北京区)', ['语音合成 0.8 元/万字符']),
    limits: null,
    trainingParams: null,
    matchAliases: ['qwen3-tts-instruct-flash'],
    events: [
      { kind: 'weights_available', occurredOn: '2026-01-21', title: 'Qwen3-TTS-12Hz CustomVoice 系开放权重发布', sourceUrl: HF('Qwen3-TTS-12Hz-1.7B-CustomVoice').url },
      rel('api_available', '2026-01-21', 'Qwen3-TTS-Instruct-Flash 上线'),
    ],
  },
  {
    provider: 'alibaba',
    officialId: 'qwen3-tts-vd',
    name: 'Qwen3-TTS-VD',
    kind: 'audio_speech',
    stage: 'ga',
    availability: ['api', 'open_weights'], // 开源对应 Qwen3-TTS-12Hz-1.7B-VoiceDesign
    summary: 'Qwen3 音色设计合成(文字描述音色特征直接合成;开源 VoiceDesign 在档)',
    sources: [DOC('qwen3-tts-vd'), HF('Qwen3-TTS-12Hz-1.7B-VoiceDesign')],
    pricing: mediaPrice('百炼平台(华北2 北京区)', ['语音合成 0.8 元/万字符']),
    limits: null,
    trainingParams: null,
    matchAliases: ['qwen3-tts-vd'],
    events: [
      { kind: 'weights_available', occurredOn: '2026-01-21', title: 'Qwen3-TTS-12Hz-1.7B-VoiceDesign 开放权重发布', sourceUrl: HF('Qwen3-TTS-12Hz-1.7B-VoiceDesign').url },
      rel('api_available', '2026-02-10', 'Qwen3-TTS-VD 上线'),
    ],
  },
  // ---- 图像生成:Qwen-Image 系 ----
  {
    provider: 'alibaba',
    officialId: 'qwen-image-3.0',
    name: 'Qwen-Image-3.0',
    kind: 'image_generation',
    stage: 'ga',
    availability: ['api'], // 3.0 未放权重(HF 最新为 Qwen-Image-2512)
    summary: 'Qwen-Image 第三代(2026-08-04 上架,权重未开放)',
    sources: [DOC('qwen-image-3.0')],
    pricing: mediaPrice('百炼平台(华北2 北京区,元/张)', ['图片输入(1K/2K)0.02 元/张', '图片生成(1K/2K)0.18 元/张']),
    limits: null,
    trainingParams: null,
    matchAliases: ['qwen-image-3.0'],
    events: [rel('api_available', '2026-08-04', 'Qwen-Image-3.0 上线')],
  },
  {
    provider: 'alibaba',
    officialId: 'qwen-image-3.0-pro',
    name: 'Qwen-Image-3.0-Pro',
    kind: 'image_generation',
    stage: 'ga',
    availability: ['api'],
    summary: 'Qwen-Image 第三代 Pro 档',
    sources: [DOC('qwen-image-3.0-pro')],
    pricing: mediaPrice('百炼平台(华北2 北京区,元/张)', ['图片输入 0.02 元/张', '图片生成 1K 0.25 元/张', '图片生成 2K 0.5 元/张']),
    limits: null,
    trainingParams: null,
    matchAliases: ['qwen-image-3.0-pro'],
    events: [rel('api_available', '2026-07-20', 'Qwen-Image-3.0-Pro 上线')],
  },
  {
    provider: 'alibaba',
    officialId: 'qwen-image-2.0',
    name: 'Qwen-Image-2.0',
    kind: 'image_generation',
    stage: 'ga',
    availability: ['api', 'open_weights'], // 开源对应 Qwen-Image-2512(2.0 系官方开源版)
    summary: 'Qwen-Image 第二代(开源版 Qwen-Image-2512)',
    sources: [DOC('qwen-image-2.0'), HF('Qwen-Image-2512')],
    pricing: mediaPrice('百炼平台(华北2 北京区,元/张)', ['图片生成 0.2 元/张']),
    limits: null,
    trainingParams: null,
    matchAliases: ['qwen-image-2.0'],
    events: [
      { kind: 'weights_available', occurredOn: '2025-12-30', title: 'Qwen-Image-2512 开放权重发布(2.0 系开源版)', sourceUrl: HF('Qwen-Image-2512').url },
      rel('api_available', '2026-03-03', 'Qwen-Image-2.0 百炼上架'),
    ],
  },
  {
    provider: 'alibaba',
    officialId: 'qwen-image-2.0-pro',
    name: 'Qwen-Image-2.0-Pro',
    kind: 'image_generation',
    stage: 'ga',
    availability: ['api'],
    summary: 'Qwen-Image 第二代 Pro 档(06-22 快照 2026-06-25 上表)',
    sources: [DOC('qwen-image-2.0-pro')],
    pricing: mediaPrice('百炼平台(华北2 北京区,元/张)', ['图片生成 0.5 元/张']),
    limits: null,
    trainingParams: null,
    matchAliases: ['qwen-image-2.0-pro'],
    events: [
      rel('api_available', '2026-04-23', 'Qwen-Image-2.0-Pro 上线'),
      rel('updated', '2026-06-25', '06-22 快照上架'),
    ],
  },
  {
    provider: 'alibaba',
    officialId: 'qwen-image-max',
    name: 'Qwen-Image-Max',
    kind: 'image_generation',
    stage: 'ga',
    availability: ['api'],
    summary: 'Qwen-Image 旗舰档(2.5 代,2025-12-30 与开源 2512 同日)',
    sources: [DOC('qwen-image-max')],
    pricing: mediaPrice('百炼平台(华北2 北京区,元/张)', ['图片生成 0.5 元/张']),
    limits: null,
    trainingParams: null,
    matchAliases: ['qwen-image-max'],
    events: [rel('api_available', '2025-12-30', 'Qwen-Image-Max 上线')],
  },
  {
    provider: 'alibaba',
    officialId: 'qwen-image-plus',
    name: 'Qwen-Image-Plus',
    kind: 'image_generation',
    stage: 'ga',
    availability: ['api', 'open_weights'], // 开源对应 Qwen/Qwen-Image(2025-08-02)
    summary: 'Qwen-Image 主力档(200 亿参数;2026-01-09 快照升级)',
    sources: [DOC('qwen-image-plus'), HF('Qwen-Image')],
    pricing: mediaPrice('百炼平台(华北2 北京区,元/张)', ['图片生成 0.2 元/张']),
    limits: null,
    trainingParams: { total: '200亿', active: null },
    matchAliases: ['qwen-image-plus'],
    events: [
      { kind: 'weights_available', occurredOn: '2025-08-02', title: 'Qwen-Image 开放权重发布', sourceUrl: HF('Qwen-Image').url },
      rel('api_available', '2025-09-23', 'Qwen-Image-Plus 上线'),
      rel('updated', '2026-01-09', '快照升级'),
    ],
  },
  {
    provider: 'alibaba',
    officialId: 'qwen-image',
    name: 'Qwen-Image',
    kind: 'image_generation',
    stage: 'ga',
    availability: ['api', 'open_weights'],
    summary: 'Qwen-Image 首代基线档',
    sources: [DOC('qwen-image'), HF('Qwen-Image')],
    pricing: mediaPrice('百炼平台(华北2 北京区,元/张)', ['图片生成 0.25 元/张']),
    limits: null,
    trainingParams: null,
    matchAliases: ['qwen-image'],
    events: [
      { kind: 'weights_available', occurredOn: '2025-08-02', title: 'Qwen-Image 开放权重发布', sourceUrl: HF('Qwen-Image').url },
      rel('api_available', '2025-08-13', 'Qwen-Image 百炼上架'),
    ],
  },
  {
    provider: 'alibaba',
    officialId: 'qwen-image-edit',
    name: 'Qwen-Image-Edit',
    kind: 'image_generation',
    stage: 'ga',
    availability: ['api', 'open_weights'], // 开源对应 Qwen-Image-Edit/-2509
    summary: 'Qwen-Image 图像编辑模型',
    sources: [DOC('qwen-image-edit'), HF('Qwen-Image-Edit')],
    pricing: mediaPrice('百炼平台(华北2 北京区,元/张)', ['图片编辑 0.3 元/张']),
    limits: null,
    trainingParams: null,
    matchAliases: ['qwen-image-edit'],
    events: [
      { kind: 'weights_available', occurredOn: '2025-08-17', title: 'Qwen-Image-Edit 开放权重发布', sourceUrl: HF('Qwen-Image-Edit').url },
      rel('api_available', '2025-09-22', 'Qwen-Image-Edit 百炼上架(2509 开源版同日)'),
    ],
  },
  // ---- 图像生成:万相 Wan 系 ----
  {
    provider: 'alibaba',
    officialId: 'wan2.7-image',
    name: 'Wan2.7-Image',
    kind: 'image_generation',
    stage: 'ga',
    availability: ['api'],
    summary: '万相 2.7 图像生成标准档',
    sources: [DOC('wan2.7-image')],
    pricing: mediaPrice('百炼平台(华北2 北京区,元/张)', ['图片生成 0.2 元/张']),
    limits: null,
    trainingParams: null,
    matchAliases: ['wan2.7-image'],
    events: [rel('api_available', '2026-04-01', 'Wan2.7-Image 系上线')],
  },
  {
    provider: 'alibaba',
    officialId: 'wan2.7-image-pro',
    name: 'Wan2.7-Image-Pro',
    kind: 'image_generation',
    stage: 'ga',
    availability: ['api'],
    summary: '万相 2.7 图像生成 Pro 档',
    sources: [DOC('wan2.7-image-pro')],
    pricing: mediaPrice('百炼平台(华北2 北京区,元/张)', ['图片生成 0.5 元/张']),
    limits: null,
    trainingParams: null,
    matchAliases: ['wan2.7-image-pro'],
    events: [rel('api_available', '2026-04-01', 'Wan2.7-Image 系上线')],
  },
  {
    provider: 'alibaba',
    officialId: 'wan2.6-image',
    name: 'Wan2.6-Image',
    kind: 'image_generation',
    stage: 'ga',
    availability: ['api'],
    summary: '万相 2.6 图像生成(image 与 t2i 双入口同模型)',
    sources: [DOC('wan2.6-image')],
    pricing: mediaPrice('百炼平台(华北2 北京区,元/张)', ['图片生成 0.2 元/张']),
    limits: null,
    trainingParams: null,
    matchAliases: ['wan2.6-image', 'wan2.6-t2i'],
    events: [rel('api_available', '2025-12-15', 'Wan2.6 图像系上线(image/t2i)')],
  },
  {
    provider: 'alibaba',
    officialId: 'wan2.5-image-preview',
    name: 'Wan2.5-Image-Preview',
    kind: 'image_generation',
    stage: 'preview',
    availability: ['api'],
    summary: '万相 2.5 图像生成预览(t2p/i2p 双入口)',
    sources: [DOC('wan2.5-t2i-preview')],
    pricing: mediaPrice('百炼平台(华北2 北京区,元/张)', ['图片生成 0.2 元/张']),
    limits: null,
    trainingParams: null,
    matchAliases: ['wan2.5-t2i-preview', 'wan2.5-i2i-preview'],
    events: [
      rel('api_available', '2025-09-19', 'Wan2.5-T2I-Preview 上线'),
      rel('updated', '2025-09-23', 'Wan2.5-I2I-Preview 上线'),
    ],
  },
  {
    provider: 'alibaba',
    officialId: 'wan2.2-t2i',
    name: 'Wan2.2 文生图',
    kind: 'image_generation',
    stage: 'ga',
    availability: ['api'],
    summary: '万相 2.2 文生图(plus/flash 双档归并一行)',
    sources: [DOC('wan2.2-t2i-plus')],
    pricing: mediaPrice('百炼平台(华北2 北京区,元/张)', ['图片生成 0.2 元/张']),
    limits: null,
    trainingParams: null,
    matchAliases: ['wan2.2-t2i-plus', 'wan2.2-t2i-flash'],
    events: [rel('api_available', '2025-07-28', 'Wan2.2 文生图系上线(plus/flash)')],
  },
  {
    provider: 'alibaba',
    officialId: 'wanx2.1-t2i',
    name: 'Wanx2.1 文生图',
    kind: 'image_generation',
    stage: 'ga',
    availability: ['api'],
    summary: '万相 2.1 文生图(plus/turbo 双档归并一行)',
    sources: [DOC('wanx2.1-t2i-plus')],
    pricing: mediaPrice('百炼平台(华北2 北京区,元/张)', ['图片生成 0.2 元/张']),
    limits: null,
    trainingParams: null,
    matchAliases: ['wanx2.1-t2i-plus', 'wanx2.1-t2i-turbo'],
    events: [rel('api_available', '2025-01-09', 'Wanx2.1 文生图系上线')],
  },
  {
    provider: 'alibaba',
    officialId: 'wanx-v1',
    name: '万相-Wanx',
    kind: 'image_generation',
    stage: 'ga',
    availability: ['api'],
    summary: '万相初代文生图模型(百炼首表可溯的最早通义模型行,2024-01-05)',
    sources: [DOC('wanx-v1')],
    pricing: mediaPrice('百炼平台(华北2 北京区,元/张)', ['图片生成 0.16 元/张']),
    limits: null,
    trainingParams: null,
    matchAliases: ['wanx-v1'],
    events: [rel('api_available', '2024-01-05', '万相 Wanx 初代上线')],
  },
  // ---- 视频生成:万相 Wan 系(t2v/i2v/r2v 等入口归并代级行)----
  {
    provider: 'alibaba',
    officialId: 'wan3.0-video',
    name: 'Wan3.0-Video',
    kind: 'video_generation',
    stage: 'ga',
    availability: ['api'],
    summary: '万相 3.0 视频生成标准版(四模态全能参考)',
    sources: [DOC('wan3.0-video')],
    pricing: mediaPrice('百炼平台(华北2 北京区,元/秒)', ['480P 0.3 元/秒', '720P 0.6 元/秒', '1080P 1.2 元/秒']),
    limits: null,
    trainingParams: null,
    matchAliases: ['wan3.0-video'],
    events: [rel('api_available', '2026-08-06', 'Wan3.0-Video 上线')],
  },
  {
    provider: 'alibaba',
    officialId: 'wan3.0-video-prime',
    name: 'Wan3.0-Video-Prime',
    kind: 'video_generation',
    stage: 'ga',
    availability: ['api'],
    summary: '万相 3.0 高速版视频生成(能力对齐标准版,最长 30 秒)',
    sources: [DOC('wan3.0-video-prime')],
    pricing: mediaPrice('百炼平台(华北2 北京区,元/秒)', ['480P 0.45 元/秒', '720P 0.9 元/秒', '1080P 1.8 元/秒']),
    limits: null,
    trainingParams: null,
    matchAliases: ['wan3.0-video-prime'],
    events: [rel('api_available', '2026-08-20', 'Wan3.0-Video-Prime 上线')],
  },
  {
    provider: 'alibaba',
    officialId: 'wan2.7-video',
    name: 'Wan2.7 视频生成',
    kind: 'video_generation',
    stage: 'ga',
    availability: ['api'],
    summary: '万相 2.7 视频生成(t2v/i2v/r2v 三入口;videoedit 属独立产品未并入)',
    sources: [DOC('wan2.7-t2v')],
    pricing: mediaPrice('百炼平台(华北2 北京区,元/秒)', ['720P 0.6 元/秒', '1080P 1 元/秒']),
    limits: null,
    trainingParams: null,
    matchAliases: ['wan2.7-t2v', 'wan2.7-i2v', 'wan2.7-r2v'],
    events: [
      rel('api_available', '2026-04-03', 'Wan2.7 视频系上线(t2v/i2v/r2v)'),
      rel('updated', '2026-07-01', '06-12 快照上架(t2v/r2v)'),
    ],
  },
  {
    provider: 'alibaba',
    officialId: 'wan2.6-video',
    name: 'Wan2.6 视频生成',
    kind: 'video_generation',
    stage: 'ga',
    availability: ['api'],
    summary: '万相 2.6 视频生成(t2v/i2v/r2v 及 flash 档归并一行)',
    sources: [DOC('wan2.6-t2v')],
    pricing: mediaPrice('百炼平台(华北2 北京区,元/秒)', ['720P 0.6 元/秒', '1080P 1 元/秒']),
    limits: null,
    trainingParams: null,
    matchAliases: ['wan2.6-t2v', 'wan2.6-i2v', 'wan2.6-r2v', 'wan2.6-r2v-flash', 'wan2.6-i2v-flash'],
    events: [
      rel('api_available', '2025-12-03', 'Wan2.6 视频系上线(t2v/i2v)'),
      rel('updated', '2025-12-16', 'r2v 入口上线'),
      rel('updated', '2026-01-15', 'r2v-flash 上线(01-29 i2v-flash)'),
    ],
  },
  {
    provider: 'alibaba',
    officialId: 'wan2.5-video-preview',
    name: 'Wan2.5 视频生成 Preview',
    kind: 'video_generation',
    stage: 'preview',
    availability: ['api'],
    summary: '万相 2.5 视频生成预览(t2v/i2v 双入口;文档 slug 无 -preview 后缀)',
    sources: [DOC('wan2-5-t2v')], // slug 例外:模型 ID 带 -preview 而 slug 不带(软 404 陷阱)
    pricing: mediaPrice('百炼平台(华北2 北京区,元/秒)', ['480P 0.3 元/秒', '720P 0.6 元/秒', '1080P 1 元/秒']),
    limits: null,
    trainingParams: null,
    matchAliases: ['wan2.5-t2v-preview', 'wan2.5-i2v-preview'],
    events: [rel('api_available', '2025-09-19', 'Wan2.5 视频生成 Preview 上线')],
  },
  {
    provider: 'alibaba',
    officialId: 'wan2.2-video',
    name: 'Wan2.2 视频生成',
    kind: 'video_generation',
    stage: 'ga',
    availability: ['api'],
    summary: '万相 2.2 视频生成(t2v/i2v plus、i2v-flash、s2v、kf2v-flash、animate 系入口归并一行)',
    sources: [DOC('wan2.2-t2v-plus')],
    pricing: mediaPrice('百炼平台(华北2 北京区,元/秒)', ['480P 0.14 元/秒', '1080P 0.7 元/秒(无 720P 档)']),
    limits: null,
    trainingParams: null,
    matchAliases: ['wan2.2-t2v-plus', 'wan2.2-i2v-plus', 'wan2.2-i2v-flash', 'wan2.2-s2v', 'wan2.2-kf2v-flash', 'wan2.2-animate-move', 'wan2.2-animate-mix'],
    events: [
      rel('api_available', '2025-07-28', 'Wan2.2 视频系上线(t2v/i2v plus)'),
      rel('updated', '2025-08-25', 's2v 入口上线(08-11 i2v-flash 先行)'),
      rel('updated', '2025-09-19', 'animate 系入口上线(09-12 kf2v-flash)'),
    ],
  },
  {
    provider: 'alibaba',
    officialId: 'wanx2.1-video',
    name: 'Wanx2.1 视频生成',
    kind: 'video_generation',
    stage: 'ga',
    availability: ['api'],
    summary: '万相 2.1 视频生成(t2v/i2v turbo/plus、kf2v、vace 系入口归并一行)',
    sources: [DOC('wanx2.1-t2v-turbo')],
    pricing: mediaPrice('百炼平台(华北2 北京区,元/秒)', ['视频生成(720P/std)0.7 元/秒']),
    limits: null,
    trainingParams: null,
    matchAliases: ['wanx2.1-t2v-turbo', 'wanx2.1-t2v-plus', 'wanx2.1-i2v-plus', 'wanx2.1-i2v-turbo', 'wanx2.1-kf2v-plus', 'wanx2.1-vace-plus'],
    events: [
      rel('api_available', '2025-01-09', 'Wanx2.1 视频系上线(t2v/i2v turbo/plus)'),
      rel('updated', '2025-02-27', 'i2v-turbo 入口上线(01-20 i2v-plus 先行)'),
      rel('updated', '2025-05-14', 'vace-plus 入口上线(04-21 kf2v-plus 先行)'),
    ],
  },
  // ---- 向量/重排 ----
  {
    provider: 'alibaba',
    officialId: 'qwen3.7-text-embedding',
    name: 'Qwen3.7-Text-Embedding',
    kind: 'embedding',
    stage: 'ga',
    availability: ['api'], // 新代开源仓未核验到(Qwen3-Embedding-8B 为上一代)
    summary: 'Qwen3.7 文本向量模型',
    sources: [DOC('qwen3.7-text-embedding')],
    pricing: textPrice('0.5', '—'), // 向量模型仅输入计价
    limits: [{ label: '最大输入', text: '131,072', scope: null }],
    trainingParams: null,
    matchAliases: ['qwen3.7-text-embedding'],
    events: [rel('api_available', '2026-07-15', 'Qwen3.7-Text-Embedding 上线')],
  },
  {
    provider: 'alibaba',
    officialId: 'qwen3-vl-embedding',
    name: 'Qwen3-VL-Embedding',
    kind: 'embedding',
    stage: 'ga',
    availability: ['api', 'open_weights'], // 开源对应 Qwen3-VL-Embedding-2B/8B
    summary: 'Qwen3-VL 图文向量模型(文本+图片输入)',
    sources: [DOC('qwen3-vl-embedding'), HF('Qwen3-VL-Embedding-2B')],
    pricing: {
      region: '百炼平台(华北2 北京区,元/百万 tokens)',
      effectiveFrom: null,
      entries: [
        { text: '文本输入 0.7 元/百万 tokens', scope: null },
        { text: '图片输入 1.8 元/百万 tokens', scope: null },
      ],
    },
    limits: [{ label: '最大输入', text: '32,000', scope: null }],
    trainingParams: null,
    matchAliases: ['qwen3-vl-embedding'],
    events: [
      { kind: 'weights_available', occurredOn: '2026-01-07', title: 'Qwen3-VL-Embedding-2B/8B 开放权重发布', sourceUrl: HF('Qwen3-VL-Embedding-2B').url },
      rel('api_available', '2026-01-21', 'Qwen3-VL-Embedding 百炼上架'),
    ],
  },
  {
    provider: 'alibaba',
    officialId: 'qwen3-vl-rerank',
    name: 'Qwen3-VL-Rerank',
    kind: 'rerank',
    stage: 'ga',
    availability: ['api', 'open_weights'], // 开源对应 Qwen3-VL-Reranker-2B/8B
    summary: 'Qwen3-VL 图文重排模型',
    sources: [DOC('qwen3-vl-rerank'), HF('Qwen3-VL-Reranker-2B')],
    pricing: {
      region: '百炼平台(华北2 北京区,元/百万 tokens)',
      effectiveFrom: null,
      entries: [
        { text: '文本输入 0.7 元/百万 tokens', scope: null },
        { text: '图片输入 1.8 元/百万 tokens', scope: null },
      ],
    },
    limits: [{ label: '最大输入', text: '120,000', scope: null }],
    trainingParams: null,
    matchAliases: ['qwen3-vl-rerank'],
    events: [
      { kind: 'weights_available', occurredOn: '2026-01-07', title: 'Qwen3-VL-Reranker-2B/8B 开放权重发布', sourceUrl: HF('Qwen3-VL-Reranker-2B').url },
      rel('api_available', '2026-01-29', 'Qwen3-VL-Rerank 百炼上架'),
    ],
  },
  {
    provider: 'alibaba',
    officialId: 'qwen3-rerank',
    name: 'Qwen3-Rerank',
    kind: 'rerank',
    stage: 'ga',
    availability: ['api', 'open_weights'], // 开源对应 Qwen3-Reranker-0.6B/4B/8B
    summary: 'Qwen3 文本重排模型(旧代现役)',
    sources: [DOC('qwen3-rerank'), HF('Qwen3-Reranker-0.6B')],
    pricing: textPrice('0.5', '—'),
    limits: [{ label: '最大输入', text: '30,000', scope: null }],
    trainingParams: null,
    matchAliases: ['qwen3-rerank'],
    events: [
      { kind: 'weights_available', occurredOn: '2025-05-29', title: 'Qwen3-Reranker 系开放权重发布(0.6B/4B/8B)', sourceUrl: HF('Qwen3-Reranker-0.6B').url },
      rel('api_available', '2025-10-21', 'Qwen3-Rerank 百炼上架'),
    ],
  },
]

// ---- 百炼「模型上下架与更新」解析(研究 §3:主发布源 SSR 纯表格。解析器随厂家基线
//  文件走,同 deepseekBaseline 先例——modelTracking.ts 接触面压到最小)----

/** 首表一行(解析后的统一形态)。 */
export interface BailianRow {
  /** YYYY-MM-DD(时间列;表内日期均零填充,防御不补零形态)。 */
  date: string
  /** 模型 ID 单元格切分(一格可含主线+latest+快照多 ID,按空白切;相对路径 ID 含斜杠原样保留)。 */
  modelIds: string[]
  /** 功能说明原文(标签已剥、空白归一;多 ID 行为该族共用说明)。 */
  description: string
}

/** 单元格文本:剥中西文间距 span 与标签、还原实体、空白归一。 */
function cellText(cell: string): string {
  return cell
    .replace(/<span class="help-letter-space"><\/span>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 'YYYY-M-D' 零填充并回滚校验(实日期);非法 → null。 */
function normalizeBailianDate(raw: string): string | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw)
  if (!m) return null
  const [, y, mo, d] = m
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)))
  if (date.getUTCMonth() !== Number(mo) - 1 || date.getUTCDate() !== Number(d)) return null
  return `${y}-${mo!.padStart(2, '0')}-${d!.padStart(2, '0')}`
}

/**
 * 页面 HTML → 首表行数组。**只取第一个 `<table>`**(华北2 北京区;页面 10 张表 = 5 唯一
 * 表 × 2 拷贝 SSR+hydration,首表即全量北京区)。表头行为 `<th>` 无 `<td>` 自然跳过;
 * 列序固定 模型类型|时间|模型ID|功能说明,时间列过不了日期校验的行(结构变化)跳过。
 */
export function parseBailianReleases(html: string): BailianRow[] {
  const table = /<table[^>]*>([\s\S]*?)<\/table>/.exec(html)?.[1]
  if (table === undefined) return []
  const out: BailianRow[] = []
  for (const tr of table.split(/<tr[^>]*>/).slice(1)) {
    const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => cellText(m[1]!))
    if (cells.length < 4) continue
    const date = normalizeBailianDate(cells[1]!)
    if (date === null) continue
    const modelIds = cells[2]!.split(' ').filter(Boolean)
    if (modelIds.length === 0) continue
    out.push({ date, modelIds, description: cells[3]! })
  }
  return out
}

/**
 * 表格行模型 ID → 基线 officialId。**精确命中优先返回**(「qwen3.7-flash」归自己,不被
 * 别的更长前缀抢走);否则取最长 `id.startsWith(alias + '-')` 前缀命中——快照/变体
 * (qwen3.7-max-2026-06-08、qwen-plus-latest)归家族行。无版本别名(qwen-plus 等)与
 * 百炼托管第三方模型(kimi-k3、ZHIPU/GLM-5.3、vidu/…)不在任何 alias 集,天然 null
 * ——这是「跟踪厂家」定义性约束(不认领非自家模型)。
 */
export function resolveQwenModelId(id: string): string | null {
  let best: string | null = null
  let bestLen = -1
  for (const b of QWEN_BASELINE) {
    for (const a of b.matchAliases) {
      if (a === id) return b.officialId
      if (id.startsWith(`${a}-`) && a.length > bestLen) {
        best = b.officialId
        bestLen = a.length
      }
    }
  }
  return best
}

/**
 * 表格行 → 每个被认领模型一条事件(kind 恒 'updated',自动解析不猜语义;同格多 ID 命中
 * 同一行只产一条)。事件信源统一为主发布源页 URL,与基线事件 sourceUrl 同构——同
 * (模型,日期,信源) 的行由 poll 跳过(基线 api_available 已覆盖的上架行不补重复动态)。
 * ponytail: 同日同模型两条表格行会撞去重键只留一条(实测首表同日同行族归并一格;
 * 若上游出现同日同模型分格双公告,再升格内序号锚)。
 */
export function matchQwenEvents(rows: BailianRow[]): Array<{ officialId: string; event: Omit<ModelEvent, 'id'> }> {
  const out: Array<{ officialId: string; event: Omit<ModelEvent, 'id'> }> = []
  for (const r of rows) {
    const claimed = new Set<string>()
    for (const id of r.modelIds) {
      const officialId = resolveQwenModelId(id)
      if (officialId === null || claimed.has(officialId)) continue
      claimed.add(officialId)
      const title = r.description.length > 160 ? `${r.description.slice(0, 157)}…` : r.description
      out.push({
        officialId,
        event: { kind: 'updated', occurredOn: r.date, title, sourceUrl: QWEN_RELEASES_URL },
      })
    }
  }
  return out
}
