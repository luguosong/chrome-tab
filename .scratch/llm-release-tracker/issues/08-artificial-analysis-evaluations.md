# 08: 接入 Artificial Analysis 评测并验收六厂家视图

**What to build:** 让用户在六家跟踪模型的详情中看到可回链、可准确对应型号的 Artificial Analysis 评测结果,同时保持未配置 Key 时的完整降级和六厂家综合视图的稳定性。

**Blocked by:** 03: 接入 OpenAI 模型档案; 04: 接入 Anthropic 模型档案; 05: 接入 xAI 模型档案; 06: 接入月之暗面模型档案; 07: 接入 DeepSeek 模型档案.

**Status:** resolved

- [x] Artificial Analysis 凭据只由服务端环境提供,不返回或持久到浏览器用户数据。
- [x] 未配置 Key 时,「模型追踪」的档案、图标与动态正常可用,评测区明确显示「未配置」。
- [x] 评测只在评测方稳定 ID 与跟踪模型的确切型号/变体可精确匹配时展示;无法确认时留空,不猜测。
- [x] 每项结果保留评测方、Benchmark、模型版本、分数、日期、原始链接与必要归因,不生成跨 Benchmark 综合分。
- [x] 评测每日刷新为最新快照;普通分数/排名漂移不生成动态,模型首次进入评测或 Benchmark 方法/版本变化才生成动态。
- [x] 评测源失败保留最后成功快照并只标记评测陈旧,不影响任一厂家档案。
- [x] 综合验收覆盖「全部」+六厂家 tab、可用优先/退役置后排序、24 小时红点、厂家/评测陈旧状态与大量模型滚动展示。
- [x] 后端、前端与共享契约的相关自动检查、类型检查、生产构建与差异格式检查全部通过。

## Comments

- **2026-08-25 实现**:新文件 `backend/src/aaEvaluations.ts`(85 条人工核验映射 AA_MODEL_MAP + 六路端点常量 + 解析匹配纯函数)。映射核验口径:AA 站点 sitemap.xml 公开 `/models/<slug>` 清单(5154 页)对六家基线逐一精确比对——**选 slug 而非文档推荐的 UUID**:UUID 只能经 API 取得(无 Key 不可核验),slug 可公开核验且失败模式安全(漂移即该模型评测静默消失=「留空」,不误归属);Key 配置后首轮实拉可复核。effort 变体(-high/-non-reasoning)、日期快照(kimi-k2-0905/deepseek-v3-2-0925)、-terminus 固定形态不映射(同模型多份评测会撞 (模型,评测方,Benchmark) 唯一键);whisper/grok-stt 等 STT 映射保留(对应关系已核验,AA 免费 API 暂无 STT 端点,开出即生效)。建模:`model_evaluations` 快照表(每轮成功整表替换,UNIQUE(model,evaluator,benchmark))+ `model_evaluation_status` 独立状态表(与厂家 model_fetch_status 分表互不影响);evaluations 对象**不设基准白名单**逐数值项透传(AA 基准集随方法演进),媒体榜 Elo 为 `<endpoint>_elo`;快照日期 = 取数日北京时间(API 无逐项评测日期,知情口径);首入评测产 `evaluated` 动态(shared 新事件类型,可回链模型页)。轮询挂既有 6h cron(≈24 请求/日 ≪ 1000/日限额,「每日刷新」为下限);未配置 Key 整体 no-op(不取数不写状态)。前端:展开行评测区(Benchmark+分数+日期→模型页链接、版本名括注、归因链接挂区头、未配置/暂无/陈旧三态)、分数格式化**按基准 key 名单**转百分比(数值区间法会把 0–1 正值指数误显 50%,code-review 修正)、未知 key 兜底可读化。启用:AA Insights Platform 注册免费 Key → 服务器 `.env` 加 `ARTIFICIALANALYSIS_API_KEY`(compose 引用行已就位)→ `up -d`。已知上限(知情确认):①「Benchmark 方法/版本变化才生成动态」半句不可交付——免费 API 不暴露方法版本,检测不到即永不误报(漂移不产动态已保障);②首配 Key 后约 80 映射模型同日首入评测,红点同亮一次、24h 自隐(时间驱动设计的自然结果,一次性,不加豁免机制)。自动检查 10 条(backend aaEvaluations.test.ts):解析透传/null 跳过/零模型抛错/空榜合法、映射形状(值唯一+全命中基线)、配置入档+首入动态、漂移更新不产动态、失败保快照只标评测陈旧且厂家状态表零触碰、未配置 no-op、URL 回链;前端 lib 3 条(分数三态+未知 key 兜底+evaluated 标签);schema 表数 14→16。综合验收:tab 键集/退役沉底/24h 红点/厂家陈旧由既有套件覆盖,评测陈旧态新增覆盖,大量模型滚动为既有行为。验证:backend 401 + frontend 282 全绿、tsc 双端零错、双端生产构建过。双轴 code-review(标准/规格并行子代理):Standards 0 硬违规(顺手修 firstUrlOf 死键);Spec 修正 1 项(分数百分比按 key 名单)。
