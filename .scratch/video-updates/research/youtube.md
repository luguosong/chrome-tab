# Research: YouTube 频道视频流取数事实（票据 01）

- 日期：2026-08-25
- 方法：官方文档（developers.google.com/youtube/v3）+ 实抓验证（本机经 mihomo 代理 `curl -x http://127.0.0.1:9981`）
- 实测样本频道：Google for Developers（`UC_x5XG1OV2P6uZZ5FSM9Ttw`）
- 标注约定：**〔实测〕**=本次实抓验证；**〔文档〕**=官方文档引证；未标注者为两者交叉。

## 1. 官方 RSS（`youtube.com/feeds/videos.xml`）

**支持的查询参数**〔实测〕：

| 参数 | 结果 |
|---|---|
| `channel_id=UC…` | 200，15 条 |
| `playlist_id=UU…` | 200，15 条（可订阅任意播放列表；uploads 播放列表即此形态） |
| `user=老用户名` | 200，15 条（legacy 变体仍活着，实测 `user=googledevelopers` 正常解析到频道） |
| `c=自定义名` | **400 不支持**（`/c/name` 变体无法直订 RSS） |

**条数上限：15 条/频道**〔实测，三种参数形态均 15〕。无分页参数。

**字段覆盖**〔实测，逐字段来自真实 entry〕：

- `yt:videoId`、`yt:channelId`
- `title`（标题）
- `link rel="alternate"`（视频页 URL；**注意 shorts 是 `…/shorts/<id>` 形态**，普通视频是 `…/watch?v=<id>`）
- `published` / `updated`（RFC 3339，updated 会随元信息修改变动）
- `author`：仅 `name`（频道名）+ `uri`（频道页 URL），**无头像**
- `media:group`：
  - `media:thumbnail`：`i*.ytimg.com/vi/<id>/hqdefault.jpg`（480×360，**只有这一档**）
  - `media:description`（完整简介文本）
  - `media:content`：老 flash 嵌入器 URL，width=640/height=360 是播放器尺寸，**不是时长**
  - `media:community`：starRating（赞数/均分）+ `statistics views`（播放数）

**视频时长：无。** 全文档无任何时长字段〔实测〕。

**更新延迟**〔实测响应头〕：`cache-control: public, max-age=900` → CDN 缓存 15 分钟，即新视频最坏约 15 分钟后才出现在 feed；量级为分钟级（未做连续观测，不下更精确结论）。响应 server 头自称 `YouTube RSS Feeds server`，是独立于主站前端的端点。

**免 key 免配额**〔实测〕：无任何鉴权，直接 200。单次响应约 26 KB。

## 2. Data API v3 取数路径与配额

**路径**〔文档〕：

1. `channels.list`（`part=contentDetails`，`id=UC…` / `forHandle=@handle` / `forUsername=用户名`）→ `contentDetails.relatedPlaylists.uploads` =「包含该频道上传视频的播放列表 ID」（channel resource 文档原文）。
2. `playlistItems.list`（`playlistId=UU…`, `part=snippet`, `maxResults≤50`）→ 每条含 `resourceId.videoId`、`title`、`thumbnails`、发布时间；**不含时长**（文档明确无此字段）。
3. 需要时长/高清图时：`videos.list`（`id=` 逗号分隔批量，`part=contentDetails,snippet`）。`maxResults` 与 `id` 互斥，实践中一批 50 个 id。

**UC→UU 推导**〔实测〕：uploads 播放列表 ID = 频道 ID 第二位 `C` 改 `U`（`UC_x5…` → `UU_x5…`）。用 RSS `playlist_id=UU_x5…` 实抓，返回与频道 feed 一致的视频流——可省一次 `channels.list`（官方口径是查 `relatedPlaylists.uploads`，推导是社区共识捷径，两者实测同值）。

**配额**〔文档 determine_quota_cost / getting-started〕：

- 所有 list 类调用（channels / playlistItems / videos）：**各 1 单位**（search.list 是 100，本项目用不到）。
- 默认每日配额 **10,000 单位**，太平洋时间午夜重置。可申请合规审计扩容（Compliance Audit），本项目量级用不上。

**字段**〔文档 video/channel resource〕：

- 时长：`contentDetails.duration`，ISO 8601（`PT15M33S` / `PT1H2M3S` / `P1DT…`）。
- 视频缩略图：`snippet.thumbnails` 的 `default`120×90 / `medium`320×180 / `high`480×360 / `standard`640×480 / `maxres`1280×720（standard/maxres 非所有视频都有）。
- 频道头像：`channels.list part=snippet` → 88×88 / 240×240 / 800×800。

## 3. 频道 URL 形态 → channel_id（纯后端）

| 主页 URL 形态 | API 解析 | 免 key 解析（抓页面） |
|---|---|---|
| `/channel/UCxxx` | URL 直读，零成本 | 同左 |
| `/@handle` | `channels.list?forHandle=@handle`，1 单位；参数接受带或不带 `@` 前缀〔文档〕 | 抓页面（~1.6 MB），`<link rel="canonical">` / `"externalId"` / `"channelId"` 任意一处 grep 即得〔实测三者均有〕 |
| `/c/name` | **无对应 API 参数**（forUsername 只认 legacy 用户名，与 custom URL 名不保证同名） | 抓页面 canonical 同样可得〔实测 200、不重定向，canonical 仍指向 `channel/UC…`〕 |
| `/user/name` | `channels.list?forUsername=name`〔文档〕 | 抓页面〔实测〕 |

实测补充：带浏览器 UA 抓三种形态均 200；页面 1.6 MB vs RSS 26 KB——页面解析只该发生在**首添博主一次性**，不进轮询循环。

## 4. 博主元信息（头像 + 昵称）

- RSS `author` 只有频道名 + 频道页 URL，**无头像**〔实测〕。
- 补法按成本排序：
  1. **API `channels.list part=snippet`，1 单位一次性**：昵称 + 头像三档（88/240/800）。若路线本就用 API 补历史，可在同一调用带 `snippet` 零额外成本。
  2. **免 key 抓频道页**：`og:image`〔实测返回 `yt3.googleusercontent.com/…=s900-c-…`，900×900 头像〕+ `og:title` 昵称。成本是 1.6 MB 页面拉取。

## 5. 50 条历史窗口 vs RSS 15 条

- RSS 只有最近 15 条，**无法**满足已定的 50 条保留窗口。
- API 补法：`playlistItems.list` 的 `maxResults` 上限恰为 50〔文档〕→ **一次调用取满 50 条（1 单位）**；再 `videos.list` 一批（≤50 id）补时长/高清图（1 单位）。首添一个博主一次性 2 单位（若需 handle 解析再 +1）。
- 结论：**「RSS 轮询 + API 一次性补历史」成立**，成本每频道 2–3 单位、日配额 10,000 下可忽略。

## 6. 轮询约束（1 小时/轮）

- **纯 RSS**：免 key 无配额，官方未发布限流数值；1 频道/小时 = 24 req/天、~26 KB/次，远低于任何已知阈值。风险面：理论上的 IP 级软限流（无文档，量小无虞）；端点独立于主站前端，前端改版不波及。CDN 15 分钟缓存 < 1 小时轮询间隔，**不会漏新视频**；唯一缺口是单频道 1 小时内发超 ~14 条把老条目挤出 15 条窗口（对「视频更新」订阅场景概率可忽略）。
- **纯 API**：每频道每轮 `playlistItems.list` 1 单位 = 24 单位/天/频道 → 10,000 配额 ≈ **416 频道封顶**（每轮再加 `videos.list` 则砍半至 ~208）。超配额即 403 quotaExceeded，当日熔断到 PT 午夜。风险面集中在配额而非封禁。
- **混合**：RSS 做变更检测（0 配额）+ 仅检出新视频时 `videos.list` 补时长（1 单位/批）→ API 成本从「每频道每轮」降为「每新视频」。

## 结论：票据 03 可判对比表

| 维度 | 纯 RSS | 纯 Data API v3 | RSS 轮询 + API 按需 |
|---|---|---|---|
| 视频时长 | ✗ 无任何时长字段 | ✓ ISO 8601 | ✓ 新视频时 `videos.list` 补 |
| 频道头像 | ✗（author 仅名+URL） | ✓ 88/240/800 | ✓ 首添一次 API（或 og:image 免 key） |
| 高清缩略图 | 仅 hqdefault 480×360 | ✓ 至 maxres 1280×720 | ✓ 需要时补；hqdefault 可兜底 |
| key/配额 | 免 key、0 配额 | 需 API key，1 单位/调用 | 需 key（增量极小） |
| 50 条历史 | ✗ 仅 15 条 | ✓ 1 调用取满 50 | ✓ API 一次性补（2–3 单位/频道） |
| 风控面 | IP 软限流（无文档，量小无虞） | 403 quotaExceeded 日熔断 | 两侧风险都被压到最低 |
| 1h 轮询成本 | 24 req/天/频道，~26 KB/次 | 24 单位/天/频道 | RSS 24 req + ~1 单位/新视频批 |
| 频道数天花板 | 无（实践无限制） | ~416（不加 videos.list；加了 ~208） | 数千级 |
| URL 形态解析 | 仅 channel_id/user 变体 | forHandle/forUsername/id 全覆盖 | 页面 canonical 兜底全形态（一次性） |

**一句话**：时长与头像是 RSS 的硬缺口且只有 API（或重页面解析）能补；配额上 1 小时/轮对三条路线都不构成压力，真正的分水岭是「要不要为时长/头像引入 API key 与按需调用」——这是票据 03 的选型命题。

## 信源

- 实抓（经代理，2026-08-25）：`feeds/videos.xml?channel_id=` / `?playlist_id=UU…` / `?user=` / `?c=`（400）；`@GoogleDevelopers`、`/c/GoogleDevelopers`、`/user/googledevelopers` 三形态页面。
- [Quota Cost — YouTube Data API](https://developers.google.com/youtube/v3/determine_quota_cost)
- [channels.list](https://developers.google.com/youtube/v3/docs/channels/list)、[channel resource](https://developers.google.com/youtube/v3/docs/channels)
- [playlistItems.list](https://developers.google.com/youtube/v3/docs/playlistItems/list)
- [videos.list](https://developers.google.com/youtube/v3/docs/videos/list)、[video resource](https://developers.google.com/youtube/v3/docs/videos)
