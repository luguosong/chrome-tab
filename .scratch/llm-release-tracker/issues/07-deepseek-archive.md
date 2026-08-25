# 07: 接入 DeepSeek 模型档案

**What to build:** 让用户查看 DeepSeek 商业 API 模型与官方开放权重模型,保留同一 API ID 原地升级的历史,并正确表示实验视觉与统一多模态模型。

**Blocked by:** 02: 补齐智谱全类型模型档案.

**Status:** resolved

- [x] DeepSeek 官方 API 的文本/推理模型与已实际上线的实验理解模型进入档案。
- [x] 同一官方 API ID 的原地升级生成新「模型动态」,不覆盖旧动态、也不伪造第二个模型。
- [x] Janus-Pro 等已由官方提供权重与实现的模型进入档案,以单一主要模型种类展示,并保留其他多模态能力事实。
- [x] 纯论文、未提供可用权重/产品/API 的预告不生成跟踪模型或动态。
- [x] DeepSeek 在图标、「全部」 tab 和独立 DeepSeek tab 中可用,详情区分 API 与开放权重渠道。
- [x] 自动检查覆盖原 ID 升级、实验阶段、开放权重归属、预告排除、陈旧降级与 tab 展示。

## Comments

- **2026-08-25 实现**:新文件 `backend/src/deepseekBaseline.ts`(12 模型基线 + DeepSeek 专属解析器/匹配器,issues/03-06 五家并行期间 modelTracking.ts 为争用热点,厂家专属纯函数随厂家基线文件走)。资料核验(2026-08-25):API Change Log(api-docs.deepseek.com/updates,HTML 无 RSS,实抓 20 日期段 21 小节)、官方 Models & Pricing 页(现役三模型 1M 上下文/384K 最大输出/并发限额/USD 峰谷×缓存价)、HuggingFace 官方 deepseek-ai 实仓(权重归属与日期、模型卡参数量:V2/Coder-V2=236B/21B、V3/R1/V3.1=671B/37B,V2.5/V3.2 卡片未单独披露→null,Janus-Pro 1B/7B 双规格→null 不混记)。建模要点:deepseek-chat/reasoner/coder 是**别名 ID** 永不立行(CONTEXT.md「跟踪模型」Avoid),V2→V2.5→V3→R1→V3.1→V3.2→V4 九次别名原地升级作为各承接模型的动态保留(V4-Pro 一行三动态:04-22 权重→04-24 API→08-13 GA 原地升级);日期/阶段快照(0517/0628/1210/0324/0528/Terminus/0731/0813)归并家族行;V3.2-Exp 是 V3.2 实验前奏归并;Speciale 曾有独立临时端点→独立行(retired,availability=[] 同 GLM-Z1 先例);别名 2026-07-24 停用后历史八代 retired 且保留 open_weights 渠道;Janus-Pro 单一主种类 multimodal_understanding,文生图能力事实留 summary,V4 双系 04-22 先权重后 API(V4-Pro 另含 APP/Web 首方渠道)。解析:HTML `<h2 id="date-…">Date:` 日期段内 `<h3 id>` 小节,标题词边界归属(同 xAI 口径——正文提及不作证据:实测 08-21 Vision-Exp 节正文提及 V4-Flash),别名/家族/平台功能段跳过;事件信源用小节锚点 URL 与 poll 产键对齐防同公告双事件;`aliasIn` 自 modelTracking 导出复用(词边界语义单一实现)。接线:modelTracking.ts 三 hunk(import/ALL_BASELINES/pollDeepSeek)+ pollQuietly 一行 + header 文档;shared ModelProviderId 扩 'deepseek';前端 PROVIDER_LABELS 加 DeepSeek(tab 自键集派生随动)。自动检查 11 条:解析(锚点/实体还原/页首噪音/畸形日期)、归属(词边界防 Vision-Exp 误认领 V4-Flash、家族/别名/非模型段跳过)、基线形状(别名不立行/种类不越研究矩阵/非退役必有渠道=预告排除)、原 ID 升级留史幂等、Janus-Pro 归属、实验阶段+快照归并、退役沉底+参数量、陈旧降级(厂家隔离/零小节=上游改版)、同公告去重+新公告自动入库、前端 tab 键集+标签。验证:backend 389 + frontend 279 全绿、tsc 双端零错;并行会话(03 OpenAI/05 xAI/06 Moonshot)同场集成,等其提交后分离提交本票 hunk。
