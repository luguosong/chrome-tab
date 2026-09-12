# LLM Gateway 机制单点化

Status: accepted

背景: ADR-0032 将调模原语放入 `translate.ts`，ADR-0060 又将候选链循环收编；此时网关机制仍与译制域代码同文件，模型核验也直接依赖该域模块。决定新增 `backend/src/llm.ts` 作为 LLM Gateway，收容共享的简单补全机制，缩小域模块边界，同时保持现有请求、候选顺序、节流、错误分类、日志和结果映射零行为变化。

决策:

1. `llm.ts` 唯一持有 `LLM_BASE_URL`、`modelCandidates`、`isCandidateExhausted`、`CandidateExhausted`、`runCandidateChain`、`callModel` 及其私有响应解析和进程级请求闸门。
2. 当前接入消费者是批量/分段译制与模型核验；它们继续各自持有 prompt、输出校验、日志、持久化和终局映射。`ai/agent.ts` 仍保留完整 tool-call、多步循环和 300s 超时语义，仅从 `llm.ts` 引用网关地址；当前无生产调用或 HTTP 端点，不把它强行改造成简单补全链。
3. 不新增 class/factory/adapter，不从 `translate.ts` 重导出；`extractContent` 保持 `callModel` 内部私有。测试按接口归属：网关机制在 `llm.test.ts`，译制协议/分段/存储在 `translate.test.ts`，核验状态映射在 `modelVerify.test.ts`。

后果: 后续简单补全消费者只依赖 LLM Gateway；工具型 Agent 上线真实消费者时，再单独决定是否接入候选链和闸门，不提前扩大本次抽取范围。历史 ADR-0032、ADR-0060 保持原文，仅由本 ADR 记录当前模块边界。

参考: ADR-0032、ADR-0037、ADR-0060。
