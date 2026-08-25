# 04 - 定稿：spec 与领域词条

Type: grilling
Status: resolved
Blocked by: 03

## Question

收束全图，产出目的地的三件交付物：

1. **spec.md**：把 map Notes 的 10 条已定决策 + 票据 03 的选型结论整理成 `.scratch/video-updates/spec.md`——领域模型（博主/分类/视频的实体与关系）、数据表草案、取数与轮询架构、tile 与 Modal 的 UI 规格、管理交互流程。细到「实施会话不再需要回来问产品问题」。
2. **CONTEXT.md 词条**：按 domain-modeling 格式落「视频更新」「博主」「分类」三个词条（含 `_Avoid_`：UP主/频道；分组——那是画布上收纳网站链接的图标类型）。注意：CONTEXT.md 可能有并行会话在改，动前 `git diff CONTEXT.md` 复查再编辑。
3. **ADR（按三要件裁夺）**：「后端持久化+定时轮询、弃易失代理」与「YouTube/B站取数路线」若满足难逆转+无上下文会惊讶+真实取舍，各落一篇 `docs/adr/`（编号顺延现有最大号）；不满足则并进 spec.md 的决策记录，不硬造 ADR。

完成后本图到达目的地。

## Answer

2026-08-25 与用户 grill 定稿,五问全按推荐:

1. **凭据缺失降级**:两平台都允许添加、缺啥显啥——无 `YOUTUBE_API_KEY` 时 RSS 15 条、无时长无头像(存量不回补);无 `BILIBILI_COOKIE` 时博主标红待自愈。与「连续 24 轮标异常不自动删」口径同构,凭据到位即自愈。
2. **首添历史 <24h 视频照常标红**:红点按发布时间客观判,不引入「按入库时间」第二套口径。
3. **B站量级按 ≤10 UP 设计**:不设博主上限、UI 不提示;spec 记「显著增长重估错峰参数」。
4. **ADR 两篇都落**:[0023 后端持久化+定时轮询](../../../docs/adr/0023-video-updates-backend-persistence.md)、[0024 双平台取数路线](../../../docs/adr/0024-video-updates-data-source-routes.md),均满足三要件。
5. **调度架构**(fog「轮询调度实现位」的答案,代码事实:更新日志串行通道实为「每源一条 promise 尾链」、资源面 LLM+npm):新建独立模块 `videoUpdates.ts` + 独立 cron(`'23 * * * *'` 非整点) + 自己的尾链;**首添博主信息同步解析(同站点信息范式)、视频历史异步投尾链即时首取**——不阻塞添加请求、不待整点、天然串行错峰,避开 B站「连发即风控」。

交付物:
- **spec**:[../spec.md](../spec.md) —— 领域模型、三张表 DDL 与 50 条淘汰 SQL、取数架构(YouTube/B站双列对照与 wbi 签名要点)、9 条 API 路由、tile/Modal/管理 UI 规格、凭据部署(compose 透传引用行)。
- **词条**:CONTEXT.md 落「视频更新」「博主」「分类」三词条(插「待办」后;并行会话的「标的/自选股」diff 无重叠)。
- **ADR**:0023、0024(编号顺延)。
