# Research: AI 模型发布/更新信源

- 查证日期：2026-08-25
- 当前范围：**智谱（Z.AI）、OpenAI、Anthropic、xAI（Grok）、月之暗面（Kimi）、DeepSeek**发布的 AI 模型
- 范围外：Google / Gemini 不属于当前发布跟踪范围
- 方法：只采用厂商官方发布页、官方文档、官方 feed、官方 API 和官方代码/权重仓库；第三方媒体与模型聚合站不进入事实链
- 结论先行：发布事实、可用渠道与网关路由是三个不同维度。发布流负责确认“何时发生了什么”，目录/API 负责发现和核验当前可用模型，AIHubMix 只表示网关可路由性。

## 1. 纳入规则与最小类型体系

### 1.1 什么算发布

只要厂商已经通过 API、首方产品或官方仓库实际提供模型，就纳入跟踪；GA、Preview、Beta、Experimental 和开放权重均可构成发布事件。只有预告、路线图、传闻或“即将推出”而尚无可访问产品/API/权重的内容不纳入。

每条模型记录应把以下正交字段分开保存：

- `modelType`：模型做什么，采用下表八类之一。
- `capabilities`：如 `reasoning`、`coding`、`vision-input`、`tool-use`；它们不是新的顶层类型。
- `distributionChannel`：`api`、`first_party_app`、`open_weights`，同一模型可多选。
- `maturity`：`preview`、`beta`、`experimental`、`ga`；开放权重不是成熟度。
- `officialModelIdOrFamily`：上游官方 ID 或明确的家族名。

### 1.2 跨厂商最小类型

| `modelType` | 包含 | 边界 |
|---|---|---|
| `text` | 语言、推理、编程、工具调用模型 | 推理/编程是能力标签，避免把同一通用模型重复分组。 |
| `multimodal_understanding` | 图像、视频或音频输入后输出文本/结构化结果；含 OCR / 文档理解 | 若主要输出是生成媒体，则归对应生成类型。 |
| `image_generation` | 文生图、图像编辑 | 不含只读图的视觉语言模型。 |
| `video_generation` | 文/图生视频、视频编辑 | 有无同步音频记为能力。 |
| `audio_speech` | 实时语音、speech-to-speech、TTS、STT/ASR、音频基础模型 | 音频理解可同时带 `multimodal_understanding` 能力，但主产品是语音/音频时归此类。 |
| `embedding` | 文本或多模态向量模型 | 不把内部向量能力当作公开模型。 |
| `rerank` | 独立可调用的重排模型/端点 | 通用模型通过提示词排序不算专用 reranker。 |
| `moderation_classification` | 独立审核、安全或分类模型/端点 | 通用模型的审核用法指南不算专用模型。 |

## 2. 六家当前类型覆盖矩阵

“未见”表示本次查证时厂商官方公开目录未列专用模型，不推断其内部能力或未来计划。

| 厂家 | 文本 | 多模态理解 | 图像生成 | 视频生成 | 音频/语音 | 向量 | 重排 | 审核/分类 |
|---|---|---|---|---|---|---|---|---|
| 智谱（Z.AI） | GLM-5.3 | GLM-5V-Turbo、GLM-OCR | GLM-Image、CogView-4 | CogVideoX-3 | GLM-TTS、GLM-ASR-2512、GLM-Realtime | Embedding-3 | `rerank` | `moderation` |
| OpenAI | GPT-5.6 Sol / Terra / Luna、gpt-oss | GPT-5.6 等图像输入模型 | GPT-Image-2 | Sora 2 / Sora 2 Pro | GPT-Realtime-2.1、GPT-Audio-1.5、GPT-Transcribe 等 | text-embedding-3-large / small | **未见专用模型** | omni-moderation-latest |
| Anthropic | Claude Fable 5、Opus 5、Sonnet 5、Haiku 4.5 | 当前 Claude 均支持图像输入 | **未见** | **未见** | **未见** | **官方明确不提供自有 embedding** | **未见自有模型** | **未见专用模型** |
| xAI | Grok 4.6 | Grok 4.6 图像输入 | Grok Imagine Image 2.0 | Grok Imagine Video 1.5 | Grok Voice Think Fast 2.0、TTS / STT | **未见专用模型** | **未见专用模型** | **未见专用模型** |
| 月之暗面（Kimi） | Kimi K3、Kimi K2.7 Code | Kimi K3；Kimi K2.6 支持图像/视频 | **商业 API 未见** | **商业 API 未见** | Kimi-Audio（开放权重） | **未见** | **未见** | **未见** |
| DeepSeek | DeepSeek V4 Pro / Flash | V4 Flash Vision Exp；Janus-Pro（开放权重） | Janus-Pro（开放权重） | **未见** | **未见** | **未见** | **未见** | **未见** |

覆盖判断依据是各厂商当前官方目录：[智谱模型广场](https://docs.bigmodel.cn/cn/guide/start/model-overview.md)、[OpenAI Models](https://developers.openai.com/api/docs/models.md)、[Anthropic model overview](https://platform.claude.com/docs/en/about-claude/models/overview.md)、[xAI Models](https://docs.x.ai/developers/models.md)、[Kimi Models](https://platform.kimi.com/docs/models.md)和 [DeepSeek Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing)。开放权重另以厂商官方仓库为准。

## 3. 推荐信源矩阵

| 厂家 | 主发布源 | 可机器核验的辅助源 | “有更新”的语义信号 | 轮询注意点 |
|---|---|---|---|---|
| 智谱（Z.AI） | [新品发布 Markdown](https://docs.bigmodel.cn/cn/update/new-releases.md)，研究/开放权重首发补充用该页回链的官方文章，如 [GLM-5.3](https://z.ai/blog/glm-5.3) | [模型广场 Markdown](https://docs.bigmodel.cn/cn/guide/start/model-overview.md)、[`llms.txt` 文档索引](https://docs.bigmodel.cn/llms.txt) | 新 `<Update label="日期" description="型号…上线">`；目录新增自研模型 ID/页面；官方文章出现可访问 API/产品/权重 | 同一型号可能先研究发布、后开放权重、再商业 API 上线，应保留多条事件。目录还托管第三方模型；例如 Vidu 不能记成智谱自研。`llms.txt` 新链接只是候选信号。 |
| OpenAI | [API changelog Markdown](https://developers.openai.com/api/docs/changelog.md)；产品/研究及开放权重发布补充用 [OpenAI News RSS](https://openai.com/news/rss.xml) | [Models API `GET /v1/models`](https://developers.openai.com/api/reference/resources/models/methods/list)、[模型目录 Markdown](https://developers.openai.com/api/docs/models.md)、[弃用页](https://developers.openai.com/api/docs/deprecations) | changelog 新日期块的模型 ID、端点或能力；RSS 新 `guid` / `pubDate`；模型 ID/类型集合变化 | ChatGPT、API、开放权重可不是同日。Models API 受 Key/权限影响，目录出现 ID 不自动提供发布日期；图像、视频、音频端点更新也要解析，不能只筛 `GPT`。 |
| Anthropic | [Claude Platform release notes Markdown](https://platform.claude.com/docs/en/release-notes/overview.md)；首发文章补充用 [Anthropic Newsroom](https://www.anthropic.com/news) | [Models API `GET /v1/models`](https://platform.claude.com/docs/en/api/models/list)、[模型总览 Markdown](https://platform.claude.com/docs/en/about-claude/models/overview.md)、[模型弃用表](https://platform.claude.com/docs/en/about-claude/model-deprecations) | release notes 日期块出现 `launched / retired` 和官方 ID；Models API 新 `id` / `created_at` / 能力；生命周期表变化 | release notes 混有 SDK/平台功能，须按明确模型名/ID过滤。Models API 需分页和 Key；`created_at` 未知时可为 epoch。当前 Claude API 从 4.6 起即使无日期后缀也是固定快照，不应按移动别名处理。 |
| xAI | [xAI Release Notes Markdown](https://docs.x.ai/developers/release-notes.md)；模型首发补充用其回链的官方文章，如 [Grok 4.6](https://x.ai/news/grok-4-6) | [Models API `GET /v1/models`](https://docs.x.ai/developers/rest-api-reference/inference/models)、[模型目录 Markdown](https://docs.x.ai/developers/models.md) | release notes 新日期标题和模型 ID/别名/模态；Models API 新 `id`、`aliases`、`created`、价格或能力变化 | Key 只返回当前可见模型。无后缀 / `-latest` 别名会迁移，日期后缀才固定；退休型号还可能被重定向。图像、视频、Voice/TTS/STT 均在同一 release notes 中，不能只筛 Grok 文本型号。 |
| 月之暗面（Kimi） | 商业模型用 [Kimi 资讯](https://www.kimi.com/news)；研究和开放权重用 [Kimi Blog](https://www.kimi.com/en/blog/) | [商业模型目录 Markdown](https://platform.kimi.com/docs/models.md)、[List Models API `GET /v1/models`](https://platform.kimi.com/docs/api/list-models)、[MoonshotAI 官方 GitHub](https://github.com/moonshotai) | 资讯/Blog 新稳定文章 URL 与日期；Models API 新 ID/能力；官方仓库发布可下载权重且 README 明确发布 | 资讯/Blog 无文档化 RSS，按文章 URL/ID去重。API 受账号 tier 影响。仓库创建不等于发布，必须同时存在权重/实现和明确发布说明；开放模型不能被误标为商业 API 可用。 |
| DeepSeek | 商业 API 用 [DeepSeek API Change Log](https://api-docs.deepseek.com/updates)及其官方 News 链接；开放权重用 [DeepSeek 官方 GitHub](https://github.com/orgs/deepseek-ai/repositories) | [List Models API `GET /models`](https://api-docs.deepseek.com/api/list-models)、[Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing) | Change Log 新 `Date: YYYY-MM-DD` 段与模型 ID；Models API ID 集合变化；官方仓库 README/Release 明确提供权重 | `deepseek-v4-pro` 等会在原 ID 上升级，ID 不变也可能是重要更新。Change Log 无官方 Markdown/RSS，解析标题而非整页 hash。仓库必须有可用权重/实现才生成开放权重事件。 |

## 4. 当前已核对的各类实例与缺口

### 智谱（Z.AI）

智谱的[模型广场](https://docs.bigmodel.cn/cn/guide/start/model-overview.md)是六家中当前类型最完整的首方目录：文本 GLM-5.3、视觉理解 [GLM-5V-Turbo](https://docs.bigmodel.cn/cn/guide/models/vlm/glm-5v-turbo)、图像生成 [GLM-Image](https://docs.bigmodel.cn/cn/guide/models/image-generation/glm-image)、视频生成 [CogVideoX-3](https://docs.bigmodel.cn/cn/guide/models/video-generation/cogvideox-3)、语音合成 [GLM-TTS](https://docs.bigmodel.cn/cn/guide/models/sound-and-video/glm-tts)、语音识别 [GLM-ASR-2512](https://docs.bigmodel.cn/cn/guide/models/sound-and-video/glm-asr-2512)、实时语音 [GLM-Realtime](https://docs.bigmodel.cn/cn/guide/models/sound-and-video/glm-realtime)、[Embedding-3](https://docs.bigmodel.cn/cn/guide/models/embedding/embedding-3)、[`rerank` 端点](https://docs.bigmodel.cn/api-reference/模型-api/文本重排序)与[`moderation` 端点](https://docs.bigmodel.cn/api-reference/工具-api/内容安全)。内容安全端点覆盖文本、图像、音频、视频。

目录中存在非智谱自研的托管模型；只有页面明确归属于智谱/GLM/Cog 系列时才进入智谱发布跟踪。第三方 Vidu 即使可从智谱平台调用，也只属于平台目录变化。

### OpenAI

[OpenAI 模型目录](https://developers.openai.com/api/docs/models.md)当前列出文本/视觉理解 GPT-5.6 Sol、Terra、Luna，开放权重 gpt-oss，图像生成 GPT-Image-2，视频生成 Sora 2 / Sora 2 Pro，实时与音频 GPT-Realtime-2.1、GPT-Audio-1.5、GPT-Transcribe 等，text-embedding-3-large / small，以及 omni-moderation-latest。当前目录未见独立 rerank 模型。

[API changelog](https://developers.openai.com/api/docs/changelog)记录 GPT-5.6 三个型号于 2026-07-09 进入 API；同一来源也会记录图像、视频、实时语音和转录模型更新，因此轮询器必须按模型 ID/端点而不是语言模型关键词筛选。

### Anthropic

[Claude model overview](https://platform.claude.com/docs/en/about-claude/models/overview.md)当前列出 Claude Fable 5、Opus 5、Sonnet 5、Haiku 4.5；当前 Claude 均支持文本和图像输入、文本输出，因此覆盖 `text` 和 `multimodal_understanding`。

当前公开目录未见 Anthropic 自有图像/视频生成、音频/语音、rerank 或专用 moderation/classification 模型。[Embedding 指南](https://platform.claude.com/docs/en/build-with-claude/embeddings)明确说明 Anthropic 不提供自有 embedding，页面推荐的 Voyage AI 是外部厂商，不能归到 Anthropic。其[内容审核用例指南](https://platform.claude.com/docs/en/about-claude/use-case-guides/content-moderation)是用通用 Claude 做审核，不构成独立 moderation 模型。

### xAI（Grok）

[xAI 模型目录](https://docs.x.ai/developers/models.md)当前覆盖文本/图像理解 Grok 4.6、图像生成/编辑 [Grok Imagine Image 2.0](https://docs.x.ai/developers/models/grok-imagine-image-2.0)、视频生成/编辑 Grok Imagine Video 1.5，以及 [Voice API](https://docs.x.ai/developers/model-capabilities/audio/voice)中的 Grok Voice Think Fast 2.0、TTS 与 STT。[Image 2.0 发布文章](https://x.ai/news/grok-imagine-image-2)确认其于 2026-08-07 GA，不是预告。

当前公开模型目录未见 xAI 专用 embedding、rerank 或 moderation/classification 模型。通用文档偶尔提到某类限额不能替代真实模型目录，故不据此推断产品存在。

### 月之暗面（Kimi）

[Kimi 商业模型目录](https://platform.kimi.com/docs/models.md)当前列出文本/推理/编程模型 Kimi K3、Kimi K2.7 Code，并列出具视觉能力的 Kimi K3 和支持图像/视频输入的 Kimi K2.6。商业 API 当前未见图像生成、视频生成、音频、embedding、rerank 或 moderation 专用模型。

音频类别仍应记录已实际发布的开放权重 [Kimi-Audio](https://github.com/MoonshotAI/Kimi-Audio)：官方仓库提供权重、实现和评测工具，覆盖音频理解、生成与对话。它的 `distributionChannel` 是 `open_weights`，不能因其不在商业 Models API 中而漏记，也不能反向标成 API 可用。

### DeepSeek

[DeepSeek API Change Log](https://api-docs.deepseek.com/updates)当前记录文本/推理模型 DeepSeek V4 Pro / Flash，以及 2026-08-21 已上线的实验模型 `deepseek-v4-flash-vision-exp`。后者属于 `multimodal_understanding`、`maturity=experimental`，因已实际可用而应纳入。

官方开放权重仓库 [Janus](https://github.com/deepseek-ai/Janus)提供 Janus-Pro 权重与实现，README 明确其统一多模态理解和文生图能力，因此分别覆盖 `multimodal_understanding` 与 `image_generation`，渠道为 `open_weights`。当前商业 API/官方公开模型仓库未见视频、音频、embedding、rerank 或 moderation 专用模型。

## 5. 名称、归属与 AIHubMix 边界

跟踪对象保存厂商、官方模型 ID/家族、类型、渠道、成熟度和来源 URL。AIHubMix 中的 `coding-`、`-free` 等前后缀是网关路由语义，不是上游模型版本；即使产品通过 AIHubMix 调用模型，也不能用网关别名匹配厂商发布页。

1. 上游事件以官方 ID / 明确家族名匹配；展示名只用于 UI。
2. `gpt-5.6`、xAI `-latest` 等可移动别名与固定型号分开保存；别名换指向属于 `alias_repointed`，不等于新家族发布。
3. Anthropic 从 Claude 4.6 起的 API ID 即便无日期后缀也是固定快照，不能套用 xAI/OpenAI 的移动别名规则。
4. AIHubMix 路由新增/撤下只记 `gateway_available` / `gateway_removed`。可轮询其[公共模型目录 API](https://docs.aihubmix.com/cn/api/Models-API)，但不能把网关 ID 当作官方存在证据。
5. 托管第三方模型不改变厂商归属：智谱目录的 Vidu、Anthropic 文档推荐的 Voyage 均不是该厂商自研发布。

## 6. 最小可靠轮询方案

1. **发布流负责事实与文案**：每 6 小时或每日轮询六家主源，提取“日期 + 官方模型 ID/家族 + 类型 + 渠道 + 成熟度 + 事件类型 + 原文 URL”。
2. **目录负责发现和核验**：厂商 Models API、模型文档与官方仓库做 ID、类型、能力和权重可用性 diff；发现候选后回查发布流，目录本身不臆造发布日期。
3. **只在真正可访问时计入发布**：Preview/Beta/Experimental/开放权重均可入库；纯 teaser 保留为人工候选，不生成发布事件。
4. **保留事件类型**：至少区分 `announced`、`api_available`、`first_party_available`、`weights_available`、`updated`、`deprecated`、`retired`、`alias_repointed`、`gateway_available`。其中 `announced` 只用于与同一公告同时发生的实际可用发布，不单独接受未来预告。
5. **同一模型允许多条事件**：研究发布、首方产品、API、权重开放、GA 和原 ID 更新可在不同日期发生，不能互相覆盖。
6. **去重键**：`provider + officialModelIdOrFamily + distributionChannel + eventKind + sourceUrl + sourceDate`。标题/描述会回改，不能只按标题去重。
7. **网关状态单独采集**：AIHubMix `model_id` 集合 diff 只生成网关事件，不改写上游发布时间、类型或成熟度。

## 7. 现场可抓取性与轮询限制（2026-08-25）

| 来源 | 本次实时结果 | 实作含义 |
|---|---|---|
| OpenAI changelog Markdown / News RSS / model catalog | 可直接请求；changelog 支持 ETag / Last-Modified | changelog 做条件请求，RSS 按 `guid` 去重，目录按 ID 与类型 diff。 |
| 智谱新品发布 / 模型广场 Markdown | 可直接请求；新品发布正文包含日期化 `<Update>` | 解析结构化更新块；模型广场只做候选发现并过滤第三方托管模型。 |
| Anthropic release notes / model overview Markdown | 可直接请求；release notes 为 `no-store` | 每次抓取后按事件键去重，不依赖 304。Models API 需 Key、默认分页。 |
| xAI release notes / models Markdown | 可直接请求；release notes 公共缓存约 1 小时 | 轮询不必短于缓存时长；同时解析 text/image/video/audio 小节。 |
| Kimi 资讯/Blog / commercial model catalog | 可直接请求；无文档化 RSS | 按文章 URL/ID 去重；GitHub 仓库需确认权重实际可下载。Models API 需 Key。 |
| DeepSeek Change Log / Models 文档 / 官方仓库 | 可直接请求；Change Log 为 HTML、无官方 RSS/Markdown | 跟随重定向并解析日期标题；同时监控原 ID 更新与开放权重仓库。Models API 需 Key。 |

## 8. 已否决信号

- Google / Gemini：已明确不在当前功能范围。
- 只盯 AIHubMix `-free` / `coding-` 路由：会把网关促销、配额或资源变化误报成模型发布。
- 只 diff Models API：会漏掉原 ID 能力/价格更新、退役计划、开放权重和分阶段发布。
- 将 `created` 一律当发布日期：只有字段文档明确如此时才可采用；其他目录创建时间仅作辅助。
- 把仓库创建、论文或 future teaser 当发布：没有可访问 API/产品/权重时不生成发布事件。
- 用第三方媒体、排行榜或聚合新闻作权威源：可辅助人工发现，但不进入自动事件事实链。
