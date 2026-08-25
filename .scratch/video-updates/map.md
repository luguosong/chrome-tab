# Wayfinder Map: 视频更新（视频博主更新跟踪）

Label: wayfinder:map

## Destination

「视频更新」功能的全部决策与规格锁定：领域词条落 CONTEXT.md、数据源选型钉死、spec 定稿于 `.scratch/video-updates/spec.md`——达到可直接开工实施的状态。写代码不在这张图内，另起实施。

## Notes

- **Domain:** 动任何领域词汇前读 `docs/agents/domain.md` 与根 `CONTEXT.md`；术语冲突立即按 domain-modeling 规则叫停。Working session 默认调 Skill "grilling" + "domain-modeling"。
- **图表形态先例（已 grill 锁定，2026-08-25，用户逐条确认）：**
  1. 单例扩展图标「视频更新」，3×2 跨格大 tile（同 AI 热点/待办范式）；块内为**全分类混合**的单列滚动视频流，分类是详情 Modal 的 tab 维度、不是画布维度。
  2. 分类由用户自由创建（仅起名、可排序）；博主**单归属**恰一类；「未分类」为默认桶。
  3. 新鲜度：时间驱动——24h 内发布的视频行带红点、满窗自隐，**无已读概念**（对齐更新日志先例）。
  4. 数据落地：后端持久化——博主注册表 + 视频表落 SQLite，后端定时轮询预取，前端只读库（对齐更新日志范式；区别于 AI 热点的易失代理）。
  5. 博主添加与管理全在详情 Modal「管理」tab：粘贴主页链接，后端解析博主信息（同「站点信息」抓取范式）；博主注册表是**账号级后端数据**（独立表），不塞图标 `data`（对齐待办范式）。
  6. Tile 行内容：`博主名 · 相对时间` 一行 + 标题一行截断 + 平台小标记（YouTube/B站）；**缩略图不上 tile**。
  7. Modal：`全部`（默认，混合时间流）→ 各分类 tab → `管理`；视频条目带缩略图 + 标题两行截断 + 博主名 + 时长 + 相对时间，整条外跳原平台。
  8. 更新延迟容忍：**1 小时内**（轮询间隔下限的依据）。
  9. 历史保留：每博主滚动保留**最近 50 条**，超出淘汰。
  10. 领域命名：图标类型「**视频更新**」；「**博主**」（YouTube 频道 / B站 UP 主的统一称谓）；「**分类**」（博主的单归属组织维度）。词条在票据 04 落 CONTEXT.md。
- **平台范围：** 本期仅 YouTube 与 B站；数据模型自然带 platform 字段，但不为第三平台预建任何抽象。

## Decisions so far

- [01 YouTube 数据源选型事实](issues/01-research-youtube-data-source.md) — RSS 15 条封顶、免 key 免配额，但**无时长无头像**；Data API 全 list 1 单位/日配额 1 万、playlistItems 一次恰取满 50 条历史；「RSS 轮询 + API 首添补历史」成立（每频道 2–3 单位）；分水岭 = 要不要为时长/头像引入 API key。
- [02 B站数据源可行性事实](issues/02-research-bilibili-data-source.md) — **游客态 arc/search 实测判死**（匿名/游客 Cookie 全抽签式，连发即 412/-352 风控、IP 级冷却不自愈），稳定取投稿列表只剩**完整登录 Cookie** 一条路；acc/info 匿名+wbi 稳、mid 即 URL 数字、缩略图 no-referrer 可直连（pic 需改写 https）；RSSHub 公共实例 Cloudflare 403 判死、自建缺时长且本质同接口；信源注意：bilibili-API-collect 原仓 2026-01 收律师函停更，文档取自 fork 镜像。
- [03 选型决策：数据源与轮询方案](issues/03-data-source-and-polling-decision.md) — YouTube「**RSS 轮询 + API 按需**」（0 配额变更检测、首添 2–3 单位补 50 历史与头像、新视频 1 单位补时长；key → [票据 05](issues/05-task-youtube-api-key.md)）；B站「**小号 Cookie 直打 wbi**」（APP 端免认证口径实测 -400 判死、RSSHub 同源风控且缺时长弃；小号 → [票据 06](issues/06-task-bilibili-cookie.md)）；轮询**双平台 1h/轮**、B站 UP 间随机 5–15s 错峰；降级四项：单轮失败下轮再试（禁密集重试）、连续 24 轮标异常不自动删、停更无语义、入库即快照不回删。
- [04 定稿：spec 与领域词条](issues/04-spec-and-glossary-finalize.md) — [spec.md](spec.md) 定稿（领域模型、三张表 DDL、双平台取数架构、9 条路由、tile/Modal/管理 UI 规格、凭据部署）；五问定死：凭据缺失允许添加缺啥显啥（自愈口径）、首添 <24h 照常标红（红点按发布时间客观判）、B站量级 ≤10 UP 不设上限、ADR 两篇（0023 持久化轮询、0024 取数路线）、调度 = 独立模块 + 非整点 cron + 自有尾链（首添博主信息同步、历史异步即时首取）；CONTEXT.md 落「视频更新」「博主」「分类」三词条。

## Not yet specified

（无——spec 定稿,fog 已清;余下仅凭据筹备两张 task 票。）

## Out of scope

- 新视频通知/提醒推送
- 站内播放或视频预览（只外跳原平台）
- 导入 YouTube/B站 的订阅列表
- 播放量/点赞等互动数据展示
- 抖音、微博等第三平台接入
