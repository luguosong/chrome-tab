# 05: 接入 xAI 模型档案

**What to build:** 让用户查看 xAI 的 Grok、Imagine 与 Voice 等官方模型及历史动态,并正确表示移动别名、固定型号和退役重定向。

**Blocked by:** 02: 补齐智谱全类型模型档案.

**Status:** resolved

- [x] xAI 官方可证实的文本/理解、图像生成/编辑、视频生成/编辑与音频/语音模型进入档案。
- [x] 独立命名的 Grok / Imagine / Voice 型号分别记录;无后缀或 `latest` 移动别名不制造重复模型。
- [x] 别名换指向与退役重定向作为动态保留,不改写原型号的发布历史。
- [x] xAI 在图标、「全部」 tab 和独立 xAI tab 中可用,详情展示官方价格、限额、来源与动态。
- [x] xAI 信源失败只标记该厂家陈旧,不影响其他厂家。
- [x] 自动检查覆盖多种模型种类、移动别名、固定型号、退役重定向和 tab 展示。

## Comments

- **2026-08-25 实现**:基线 17 型号(新文件 `backend/src/xaiBaseline.ts`):文本 8(Grok 4.6 / 4.5 / 4.3 / Build 0.1 / 4.20 三个固定快照行 / 退役 grok-code-fast-1)、图像生成 3(Imagine Image 2.0 / Quality / Image)、视频生成 2(Imagine Video 1.5 / Video)、音频 4(Voice Think Fast 2.0 / 1.0、Speech to Text、Text to Speech)。资料核验(2026-08-25 实抓):模型目录三张价格表、10 个模型文档页(别名清单/速率限额/区域)、官方发布流、5 篇 x.ai/news 发布文章 datePublished 钉死首发日。ID 口径:移动别名(grok-voice-latest 等)不另立行;Grok 4.20 家族仅在 -0309 固定快照在售,以固定 ID 入档(CONTEXT.md「跟踪模型」词条补此口径);TTS/STT 无官方模型 ID,按能力文档 slug 入行(GA 有发布流佐证)。动态日期三口径(基线头注释声明):官方文章精确日期 / 发布流月份锚定当月 1 日 / 文档页无日期在售状态取核对日并标题注明。wire 契约:ModelProviderId + 'xai'、ModelEventKind + 'alias_repointed'(grok-voice-latest → think-fast-2.0,官方发布流明文 2026-08-05 生效);退役重定向两条:think-fast-1.0 官方价格表 Deprecated(原上线 2026-04-23 保留不改写)、grok-code-fast-1 保留沉底行 + retired 动态注明重定向至 grok-build-0.1。解析:parseXaiReleaseNotes(`## 月份`/`### 条目`,当年标题不带年份按 currentYear、显式年份自锚)+ matchXaiEvent(标题词边界单条件——条目标题即官方条目名自证归属,正文链接常指能力文档不作 slug 证据;家族合并条目多命中)+ pollXai 搭 pollOne/ingest 公共管线(issues/04 会话所建);BaselineModel.matchSlugs 转 optional。验证:backend 52 + frontend 279 全绿(月粒度锚定、词边界、家族多命中、厂家隔离、上游改版、tab 派生)、tsc 双端零错(本票文件)。双轴 code-review:Standards 1 硬伤已修——基线事件信源 URL(无 .md)与轮询 URL(带 .md)分裂会击穿同公告去重键,统一为带 .md 并加守护测试;CONTEXT.md「模型动态」词条补别名换指向/退役重定向口径。3 项判断题(链接正则两解析器重复、命中类型未命名、docs origin 裸串)均涉并行会话在途共享代码,留待收口票统一处理。xAI 主体实现随 issues/04 会话的提交 7ad962c 一并入库(共享文件被其快照卷入,fix-forward);本票收尾提交补评审修正、守护测试与 CONTEXT 词条。
