# 跑分榜:只按评测方原生单维度指数排序,纯前端派生,不截 top-N

背景:「模型追踪」详情 Modal 要加「跑分榜」tab 按编程能力给模型排名,但 CONTEXT.md「评测结果」词条明文避讳「综合分、万能排名」——两个诉求正面相撞。事实底盘:AA(Artificial Analysis)免费 API 的 LLM 主表本就随每模型返回 `artificial_analysis_coding_index` 等原生聚合指数(2026-08-27 线上实测 50 个模型带编程指数),且后端 `matchEntries` 只保留 `AA_MODEL_MAP` 内的跟踪厂家条目——数据已随 `/api/model-tracking/archive` 全量到前端。

**决策一(排序键):只认评测方原生单维度指数,不自制合成。** 排序键 = AA 编程指数(评测方自己的聚合,我方原样呈现),不用以下替代:自算 CODING 区块各 benchmark 均分(= 被禁的归一化合成)、拿单一 benchmark 定排名(武断且信息量低)。边界措辞已补进「评测结果」词条:原样排序视图 ≠ 综合分/万能排名。

**决策二(全集):档案内全量,不截 top-N。** 榜单 = 档案内带编程指数的**全部**模型(现 50 个)降序排列——「前 20」的截断在全集仅 50 时无信息增益,且截断线会随 AA 覆盖漂移。不扩 `AA_MODEL_MAP` 去收 AA 全榜:档案外模型是点不开的孤儿行,违背「模型追踪以跟踪厂家为界」。

**决策三(实现):纯前端派生,零后端改动。** `codingLeaderboard()` 在前端对既有 `TrackedModel.evaluations` 过滤排序,明细 benchmark(Terminal-Bench v2.1 / Hard、LiveCodeBench)只展示不参与排序;「模型种类」过滤胶囊在该 tab 隐藏(过滤轴只服务模型列表);归因链接按 AA 免费 API 条款保留。新 tab 固定挂厂家 tab 序列末位,不打乱派生序。
