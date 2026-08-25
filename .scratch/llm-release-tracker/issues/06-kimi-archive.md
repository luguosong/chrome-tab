# 06: 接入月之暗面模型档案

**What to build:** 让用户同时查看月之暗面的商业 Kimi 模型与已实际发布的官方开放权重模型,且不把仓库创建或预告当成发布。

**Blocked by:** 02: 补齐智谱全类型模型档案.

**Status:** resolved

- [x] Kimi 官方商业模型目录中可证实的文本、编程与理解模型及其历史动态进入档案。
- [x] Kimi-Audio 等官方仓库已提供可用权重/实现与明确发布说明的模型进入档案,开放方式标为开放权重而非商业 API。
- [x] 只创建仓库、只发论文或仍处于未来预告的项目不生成跟踪模型或动态。
- [x] 月之暗面在图标、「全部」 tab 和独立厂家 tab 中可用,商业与开放权重渠道在详情中清楚区分。
- [x] 资讯/Blog 无稳定 feed 时按官方文章标识与 URL 去重,源失败保留最后成功档案。
- [x] 自动检查覆盖商业/API 与开放权重归属、预告排除、文章去重、陈旧降级与 tab 展示。

## Comments

- **2026-08-25 实现**:基线 11 模型(新文件 `backend/src/kimiBaseline.ts`),收录边界 = 开放平台模型列表 platform.kimi.com/docs/models.md 全部三张表(多模态表 5:K3/K2.7 Code/K2.7 Code HighSpeed/K2.6/K2.5;Moonshot V1 表归并为 text 行 + vision 变体行,种类不同分立;已下线表 3:kimi-k2 家族[0711/0905 快照归并,turbo 服务档随家族]、K2 Thinking、Thinking Preview;kimi-latest 为移动别名不另立)+ Kimi-Audio 开放权重。资料核验(2026-08-25):模型列表 Markdown、五张定价页(¥/百万 tokens 缓存命中/未命中分列,region=Kimi 开放平台人民币)、Kimi 资讯(4 条产品新闻)与 Blog 索引(19 张卡片,官方日期)、HuggingFace moonshotai org 实仓(K3/K2.7-Code/K2.6/K2.5/K2/K2-Thinking/Kimi-Audio 均有权重分片)。关键口径:K3 仓库 06-13 先建、07-17 资讯发布、07-27「开放日」公布权重——api_available/weights_available 分记;K2 = 1T/32B(发布文章原文),K3 总量 2.8万亿、激活未披露(896 专家激活 16 是专家数非参数量);K3 发布后 k2.5/moonshot-v1 停新用户、2026-08-31 下线 → stage=deprecated。排除(负例有测试):kimi-latest(别名)、K3 开放日 Infra 组件(MoonEP/FlashKDA/AgentEnv,非模型)、研究仓 Kimi-VL/Kimi-Dev/Kimi-Linear/Moonlight/MoonViT(不在商业目录,研究 §2 Kimi 覆盖矩阵未列——研究范围裁决,待后续核验再议)。轮询:月之暗面唯一无 Markdown/RSS 主源的厂家——资讯 + Blog 两页卡片确定性解析(覆盖整卡 aria-label 锚点,日期取 card-title 之后——头图 URL 常含上传日期 08-11 配 07-27 文章,取窗口首个日期会错记)、标题最长 alias 归属(「Kimi K2 Thinking」不误归「Kimi K2」)、pollOne 复用 + 单页失败另一页照常入库、**循环后统一补压陈旧终态**(pollOne 按页标记,后页成功会覆盖前页失败——测试逼出的真 bug)。基线事件信源 = 官方文章 URL(与轮询卡片同键去重):现网两页一轮解析后仅 K3 技术博客(07-16)产 1 条自动 updated,其余全部被基线占键。前端:PROVIDER_LABELS 加「月之暗面」即 tab 随动(TABS 自派生),availability 行内 API/开放权重并列即渠道区分。测试:后端 16 条 Kimi 用例(解析/归属/基线/服务四组)+ 共享测试闩锁跟六厂家(TOTAL_BASELINE/retired/routes sources)。验证:backend modelTracking 90/92(余 2 为并行会话 deepseek 飞行中)、frontend 279 全绿、tsc 本任务文件零错。与并行会话(03/05/07)在同一批 seam 文件上交错落盘,闩锁行(TOTAL_BASELINE、retired 清单、路由 sources 数)由后落会话递增,本轮我方按工作区现实补至六厂家。
- **2026-08-25 双轴 code-review(标准/规格并行子代理)**:标准轴零硬违规;判读项——HighSpeed 分立判据(独立 API ID+独立定价,与「相同模型不另算」的张力已在基线头注释立据)、`window` 遮蔽全局名、Kimi 单命中 vs xAI/OpenAI 多命中口径(已文档化,双模型同文出现时再升)。规格轴三项修正落地:①K2.7 Code 的 weights_available 原借 HF 仓库创建日当发布日,违反研究 §3「仓库创建≠发布」——删该事件(open_weights 渠道为 HF 权重实核事实,保留);②退役模型 kimi-k2/K2-Thinking 原仍带 api 渠道与自身下线事件矛盾——改 ['open_weights'](GLM-Z1 availability=[] 同口径),thinking-preview(API 专属)改 [];③K2.7 Code kind=text 与 K2.6 多模态的种内差异补注释(研究 §2 矩阵列归属)。未修(记录):kimi-k2.5/moonshot-v1 弃用无 deprecated 事件——官方公告不携日期,造日期即臆造,stage+summary 承载;`window`→`cardWindow` 一并落地。评审后 backend modelTracking 94 绿。
