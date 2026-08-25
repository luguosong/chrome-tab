# 01 - Research: YouTube 数据源选型事实

Type: research
Status: resolved

## Question

为「视频更新」的 YouTube 取数钉死事实基础（只查证、不选型——选型是票据 03 的事）。用高信源（官方文档、实际抓包验证）回答：

1. **官方 RSS**（`youtube.com/feeds/videos.xml?channel_id=UC…`）：每频道返回条数上限（~15?）、字段覆盖（标题/发布时间/缩略图/链接/作者）、**有无视频时长**、更新延迟、是否免 key 免配额。
2. **Data API v3**：`channels.list`→uploads playlist→`playlistItems`+`videos.list` 的取数路径；各调用配额成本（每日 10000 单位够轮询多少频道×频率）；能拿的字段（时长/高清缩略图/频道头像）。
3. **频道 URL 形态解析**：`/@handle`、`/channel/UCxxx`、`/c/name`、`/user/name` 四种主页 URL 各自怎么解析出 channel_id（纯后端、无浏览器环境）；RSS 是否支持 user/c 变体直订。
4. **博主元信息**：频道头像与昵称，RSS 的 author 覆盖多少、不够的话最便宜的补法（API? 页面解析?）。
5. **50 条历史**（已定的保留窗口）vs RSS ~15 条窗口：首添博主时「RSS 轮询 + API 一次性补历史」组合是否成立、成本多少。
6. **轮询约束**：1 小时/轮的节奏下，纯 RSS 与 API 各自的风险面（限流/封禁）。

产出写 `.scratch/video-updates/research/youtube.md`，结论段须直接给「票据 03 可判」的对比表。

## Answer

6 问全部查证（官方文档 + 代理实抓真实频道）：RSS 每频道 15 条封顶、免 key 免配额、**无视频时长、无头像**（author 仅名+URL，缩略图仅 hqdefault 480×360，CDN 缓存 15 分钟）；Data API 全 list 调用 1 单位、日配额 10,000，`playlistItems.list` 一次恰取满 50 条、`videos.list` 给 ISO 8601 时长与最高 1280×720 缩略图，1h/轮纯 API ≈ 416 频道封顶；四种 URL 形态纯后端均可解析（forHandle/forUsername/canonical 抓页，`c=` 变体 RSS 不直订）；「RSS 轮询 + API 首添一次性补 50 历史」成立，每频道仅 2–3 单位。分水岭 = 要不要为时长/头像引入 API key。

详见 [`../research/youtube.md`](../research/youtube.md)（含票据 03 对比表与信源）。
