# 05 - Task: YouTube Data API key 申请

Type: task
Status: open

## Question

为票据 03 定死的「RSS 轮询 + API 按需」路线备妥凭据（人工操作为主，HITL）：

1. Google Cloud Console 建项目 → 启用 **YouTube Data API v3** → 创建 **API key**（免费层即日配额 10,000 单位，无需申请扩容）。
2. key 落位:`.env` 加 `YOUTUBE_API_KEY=…`,并确认 deploy compose 有对应 `${YOUTUBE_API_KEY}` 引用行（**透传暗坑**:.env 加键 ≠ 容器拿到值，须 compose 显式引用——weather 线上 500 数月的旧因）。
3. 验证:用该 key curl 通一次 `channels.list?forHandle=…`（1 单位）即完成。

完成记录:key 所在 .env 键名、验证调用的返回 gist，供票据 04（spec 引用）与实施依赖。

注:与票据 04 并行，不互相阻塞——spec 只需引用键名与配额事实，不需 key 实际到手。
