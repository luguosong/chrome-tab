# 04: 接入 Anthropic 模型档案

**What to build:** 让用户查看 Anthropic 自有 Claude 模型的官方历史、资料与生命周期,且不把 Anthropic 文档推荐的外部模型或通用用法指南误认为自有模型。

**Blocked by:** 02: 补齐智谱全类型模型档案.

**Status:** resolved

- [x] Claude 独立命名的 Opus、Sonnet、Haiku 等型号/变体及其官方发布、价格、限额、弃用和退役动态进入档案。
- [x] Claude 以文本为唯一主要模型种类;视觉输入不造成第二条重复模型记录。
- [x] Anthropic 文档推荐的外部 Embedding 厂家不归入 Anthropic;通用 Claude 的审核用法不冒充独立审核模型。
- [x] Anthropic 在图标、「全部」 tab 和独立 Anthropic tab 中可用,退役模型保留并排在可用模型之后。
- [x] Anthropic 信源失败只标记该厂家陈旧,不影响其他厂家。
- [x] 自动检查覆盖厂家归属、固定型号识别、外部模型排除、退役保留和 tab 展示。

## Comments

- **2026-08-25 实现**:基线 16 模型(新文件 `backend/src/anthropicBaseline.ts`),收录边界 = 弃用表 Model status 表「Current and recently retired」(Active 10 + Retired 6),kind 全为 text(视觉输入写进 summary 不另立行)。资料核验(2026-08-25 真网):模型总览 comparison 表(当前 lineup 4 个的 ID/上下文/最大输出/价格)、弃用表(退役模型 6 个的 deprecated/retired 日期)、官方定价页(全型号美元现价;3.7 Sonnet 与 3 Haiku 定价页已不列示 → pricing null)、context windows 文档(1M 家族 = Fable 5/Opus 5/Opus 4.6-4.8/Sonnet 5/4.6,其余 200K)、release notes(各代发布日期;3 Haiku 早于 release notes 覆盖起点 2024-05-10,只有弃用/退役事件)。ID 口径:4.6 世代起无日期后缀 ID 即固定快照直接入档(officialId 无 `-20xxxxxx` 后缀;dated 快照归并家族行);仅限 Project Glasswing 受邀者的 Mythos 5/Preview 不在公开目录,不纳入(归属负例有测试)。主发布源 = release notes Markdown(研究 §3):新增 `parseAnthropicReleases`(`### 日期`段 + `* `条目,日期归一兼容 'October 3rd, 2024' 序数后缀)与 `matchAnthropicEvent`(与智谱同构双条件:条目原文 alias 词边界 + 条目内链接 slug 尾边界;SDK/平台功能条目天然跳过)。`pollZhipu`/`pollAnthropic` 共抽 `pollOne`+`ingest`(事件幂等入库),失败按厂家隔离;`init` 遍历 `ALL_BASELINES`。修一处既有 bug:`aliasIn` 词边界把英文句尾句点当版本号延续(「Claude Opus 4.8. See…」被拒),尾边界改 `(?![\w-]|\.\w)`——句点后跟标识符才算延续;智谱中文语境侥幸未触发,Anthropic 英文条目句句触发。shared `ModelProviderId` 扩 'anthropic',前端 `PROVIDER_LABELS` 加条目即 tab 随动(Modal TABS 自键集派生,零组件改动)。基线事件 sourceUrl 与自动解析产键对齐(发布条目内的模型页/新闻链接;3.5 Haiku 发布条目链接产品页无本型号 slug,sourceUrl 落 release notes 总页)。验证:backend 336 + frontend 279 全绿、tsc 双端零错(本任务文件);真网 smoke——release notes 全文 263 条解析、17 条命中,发布公告与基线事件同键去重、Mythos 零行、无误报;生产 fetchText 真抓 URL 可达。测试(makeDeps 升级为按 URL 分发页面的双厂家语义)覆盖:日期归一/条目提取/双条件归属/基线外跳过/词边界/快照链接不认领、厂家归属与唯一性、外部模型排除(Voyage/审核负例)、固定型号识别(dateless 入档/dated 不另立)、16 模型入档与价格限额落库、退役排序与三事件共存、历史去重、自动解析新公告、双厂家信源隔离(单家陈旧不牵连)、信封双源、前端 tab 键集。**并行会话撞车**:工作期间多个并行会话在同一工作区批量接入其余厂家(03/05/06/07 的基线文件陆续出现并持续写入 shared 与 modelTracking)。提交策略经用户裁决(commit 7ad962c):以「当前混合态整体入库」——Anthropic 全套 + 已完成接线的 xAI 全套(xaiBaseline/parseXaiReleaseNotes/matchSlugs 可选化/alias_repointed 事件类型)一并提交;03/06/07 未接线基线(untracked)留场由各自会话收尾。

- **2026-08-25 双轴 code-review(commit 7ad962c)**:Standards 轴无硬违规;Spec 轴六条验收无实质缺失。两项记录在案、未动代码(共享文件正被并行厂家会话高频写入,当下动核心文件必再撞车):①`matchAnthropicEvent` 首个命中即 return 的单命中语义,与 `claude-opus-4`/`claude-sonnet-4` 两行「共用 news/claude-4 链接、别名各自认领」的注释矛盾——合并发布条目只会给先出现的 opus-4 产自动动态(当前零影响:两家基线 api_available 已占同键;未来若再现合并条目第二家会漏一条 updated)。②`anthropicNoteTitle` 按 '. ' 截首句,"U.S." 类缩写截在句中(纯展示瑕疵)。重构建议一并记录给下次厂家票:matchZhipu/Anthropic 双条件循环同构可抽共享、链接提取正则两处重复、厂家接入改动点散落 5 处可塌缩为厂家描述表(已到第三次真实重复)。
