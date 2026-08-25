# 03: 接入 OpenAI 模型档案

**What to build:** 让用户在「模型追踪」中查看 OpenAI 官方发布的各类 AI 模型、历史、当前资料与动态,同时避免别名和快照造成重复。

**Blocked by:** 02: 补齐智谱全类型模型档案.

**Status:** resolved

- [x] OpenAI 官方目录与发布记录中可证实的文本/理解、图像、视频、音频/语音、向量、审核/分类及开放权重模型进入档案。
- [x] 产品发布、API 上线、权重开放、阶段、价格、能力、限额、弃用与退役等官方动态按事件分别保留。
- [x] GPT 的独立命名型号/变体各算一个跟踪模型;移动别名、`latest` 与日期快照不另占一行。
- [x] OpenAI 出现在图标、「全部」 tab 与独立 OpenAI tab;行展开后能查看资料、来源与时间线。
- [x] OpenAI 信源失败只标记该厂家陈旧,不清空档案或影响其他厂家。
- [x] 自动检查覆盖官方条目解析、型号/别名/快照去重、多阶段动态、厂家降级与前端 tab 展示。

## Comments

- **2026-08-25 实现**:基线 91 行(新文件 `backend/src/openaiBaseline.ts`),覆盖官方模型目录 96 条 ID 的全量归并 + 弃用页 2025 年后有官方记录的已退役模型(dall-e-2/3、codex-mini-latest 等)。资料核验(2026-08-25,全部一手):模型目录 models.md 与逐模型文档页 .md(96 页实抓:上下文/最大输出/模态/端点)、官方价格页 pricing.md(标准档逐表)、API changelog.md(上线日期)、弃用页 deprecations.md(公告日/关停日)、HuggingFace openai 实仓(gpt-oss 参数量 117B/5.1B 与 21B/3.6B 官方 README 口径)。归并规则落地:独立变体(Sol/Terra/Luna、Codex 系列各型号)各一行;移动别名(chat-latest、gpt-5.x-chat-latest、chatgpt-4o-latest、chatgpt-image-latest、daybreak-red/blue-latest)与日期快照(-2026-04-21 等)不另立行,text-moderation 的 latest/stable/007 三别名归一行;目录无独立 rerank 模型故无该类行,GPT 主线图像输入按能力处理(种类仍 text)。解析器:changelog 类型行 `Model: id` 是结构化归属字段,精确 alias 命中优先 + 最长前缀快照归族(resolveOpenAIModelId),与智谱/Anthropic 的双条件归属各自适配信源形态;锚点 URL 由 openaiBaseline 导出的 openaiChangelogAnchor 单一来源(基线事件与自动解析共用,防两处拼串漂移——开发期实测月份差一 bug 即此类)。事件:基线语义化事件覆盖上线/降价/弃用/退役/权重开放,同公告自动解析经 (模型,日期,锚点) 键去重;真网 smoke 验证 Jul-9 家族公告恰 1 条 api_available、基线未覆盖的 fast-mode/降价条目以 updated 补充入库。厂家隔离:pollOpenAI 失败(含 200 零结构化条目的改版口径)只置 openai 陈旧,档案保留。验证:backend tsc 零错、modelTracking OpenAI 新增 13 用例全绿、frontend 9 用例全绿 + tsc 零错、真网 smoke(openai:ok,91 行)。双轴 code-review(标准/规格并行子代理)修正:matchSlugs 空数组 91 行删除(xAI 同款省略口径);omni-moderation 改基名立行(latest 移动别名入 aliases,对齐 text-moderation 先例);changelog 抓取 URL 改由 openaiBaseline 导出的页基址派生(单一事实源);gpt-oss 的 released 拆为 weights_available + api_available 两条(同日双渠道按事件分立,AC2);裸家族别名 gpt-5.6 入 sol 行 aliases(条目以家族名引用时不再悬空);「产品发布」维度补齐——官方 News RSS 实抓核验 Sora 2 产品发布 2025-09-30(Sora App/ChatGPT)与 GPT-5.6 Sol/Luna 在 ChatGPT(2026-08-06 官方文章)各补 first_party_available 事件与 first_party_app 开放方式;同日同模型多公告撞日粒度锚点记为已知上限(matchOpenAIEvents 注释)。已知边界: multimodal_understanding 无独立行(GPT 主线图像输入按能力归 text,研究 §1.1 口径);ChatGPT 专属快照(chat-latest 家族)无独立事件载体;GPT-3 时代 completions 系不回填。注:并行会话(issues/06/07)同时接线,modelTracking 共享测试脚手架(TOTAL_BASELINE/退役清单/sources 计数)为三家共建,退役清单断言已改为自基线推导(新厂家票不再改此处)。
