# Research: 模型评测与训练参数信源

- 查证日期:2026-08-25
- 范围:智谱、OpenAI、Anthropic、xAI、月之暗面、DeepSeek 的跟踪模型
- 原则:评测站点是其自有分数的一手来源,但不是厂家事实来源;每个分数必须保留评测方、Benchmark、模型版本、日期和原链接。

## 结论

首版只接 **Artificial Analysis**。它的[官方免费 API](https://artificialanalysis.ai/api-reference/)提供稳定的 model / creator ID,明确要求归因,每日限 1,000 请求,并要求 API Key 只放服务端且缓存结果。免费端点覆盖语言模型、文生图、图像编辑、TTS、文生视频和图生视频;响应带独立评测分、价格和性能指标。

不将 Artificial Analysis 的 Intelligence Index 当成跨类型「综合分」。其[智能评测方法](https://artificialanalysis.ai/methodology/intelligence-benchmarking)明确它是主要面向英文文本模型的加权指标,图像输入、语音输入和多语言能力分开评测。图像、视频、音频结果也各自保留 Benchmark;例如[视频评测方法](https://artificialanalysis.ai/video/methodology)为文生视频、图生视频、视频编辑及含音频变体分别维护 Elo 池,不跨模态比分。

## 更新语义

Artificial Analysis 的某些指标是活动窗口而非一次性发布事实。例如视频质量 Elo 每小时重算,生成耗时是最近 14 天中位数。若每次数值漂移都写入「模型动态」,时间线会被重算噪声淹没。推荐把分数作为可更新快照;仅「新模型首次进入评测」或「Benchmark 方法/版本变更」产生动态。

## 本期不自动接入的候选

- **LM Arena**:官方项目说明其为匿名随机对战的人类偏好评测,GitHub 提供[榜单方法源码](https://github.com/lmarena/arena-rank),但本次未找到面向产品集成的稳定、版本化公开数据 API。可作外链,不抓 UI。
- **LiveBench**:[官方论文与数据](https://livebench.ai/livebench.pdf)可复现、按月更新,但只覆盖语言模型的六类任务,无法支撑全部八种「模型种类」。待确实需要第二个语言基准时再接。
- **Hugging Face Open LLM Leaderboard**:[官方 FAQ](https://huggingface.co/docs/leaderboards/main/open_llm_leaderboard/faq)明确只评开放权重语言模型,且同一模型会因 commit 和精度重复出现。它适合开源模型研究,不适合作六家全模型的通用主源。

## 训练参数量

参数量只从厂家公告、官方论文、官方模型卡或官方权重配置获取。闭源厂家未披露时保留未知;MoE 模型分别保存总参数和激活参数。Artificial Analysis、其他榜单或媒体不用于填补参数量。
