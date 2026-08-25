# 视频更新 spec

状态:定稿(2026-08-25,票据 04)。依据:[map](map.md) Notes 十条、[票据 03 选型](issues/03-data-source-and-polling-decision.md)、[research/youtube.md](research/youtube.md)、[research/bilibili.md](research/bilibili.md)、ADR-0023、ADR-0024。

一句话:单例扩展图标「视频更新」,3×2 大 tile 全分类混合视频流 + 详情 Modal(全部/分类/管理 tab);博主注册表与视频持久化 SQLite,后端 1h 定时轮询预取(YouTube「RSS 轮询 + API 按需」、B站「小号 Cookie 直打 wbi」),前端只读库。

## 领域模型

三个实体,关系一句话:**分类** 1—N **博主**(单归属,空 = 未分类);**博主** 1—N **视频**(每博主滚动保留最近 50 条)。

- **博主 (Blogger)**:视频发布者,YouTube 频道与 B站 UP 主的统一称谓。属性:平台、平台用户标识(YouTube channel_id `UC…` / B站 mid 数字)、名称、头像 URL(可空)、所属分类(可空 = 未分类)、取数健康度(fail_streak 派生 status)。元信息首添时取一次;轮询顺带刷新名称(响应里免费带回:YouTube RSS `author.name`、B站 vlist `author`),头像不刷新。同一 `(user, platform, platform_user_id)` 唯一,重复添加报 4xx。
- **分类 (Category)**:博主的组织维度,用户自由创建——仅起名、可排序。**「未分类」是虚拟桶**(category_id NULL),不是实体行,不可删不可改名;删除分类时其博主经 `ON DELETE SET NULL` 回归未分类。
- **视频 (Video)**:博主的投稿条目。属性:平台视频标识(YouTube videoId / B站 bvid)、标题、URL(取数侧直接存完整 URL,前端不构造)、缩略图 URL、时长秒(可空)、发布时间(unix 秒)。**入库即快照,不回删**(上游被删的视频照旧展示,由 50 条滚动窗口自然淘汰)。

新鲜度口径:发布时间(`published_at`)在 24h 内的条目带红点——**按发布时间判,不按入库时间**(首添补历史时恰逢博主昨天发片,照常标红,「这位刚订阅的博主昨天更新了」是正确信息)。时间驱动、满窗自隐,无已读概念(对齐「更新日志」红点先例)。

排序口径:tile 混合流、Modal「全部」、各分类 tab 一律 `published_at DESC`(跨平台统一)。

## 数据表(SQLite,schema.ts migrate() 幂等追加)

```sql
CREATE TABLE IF NOT EXISTS video_categories (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS video_bloggers (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  platform TEXT NOT NULL,             -- 'youtube' | 'bilibili'
  platform_user_id TEXT NOT NULL,     -- YouTube channel_id(UC…) | B站 mid
  name TEXT NOT NULL,
  avatar_url TEXT,                    -- 空 = 无 key 首添的 YouTube 博主
  category_id INTEGER REFERENCES video_categories(id) ON DELETE SET NULL,
  fail_streak INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ok',  -- 'ok' | 'failing'
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, platform, platform_user_id)
);

CREATE TABLE IF NOT EXISTS videos (
  id INTEGER PRIMARY KEY,
  blogger_id INTEGER NOT NULL REFERENCES video_bloggers(id) ON DELETE CASCADE,
  platform_video_id TEXT NOT NULL,    -- YouTube videoId | B站 bvid
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  thumbnail_url TEXT,
  duration_seconds INTEGER,           -- 空 = 未知(无 key 时的 YouTube 视频请)
  published_at INTEGER NOT NULL,      -- unix 秒(B站 created 原生;YouTube RFC3339 转换)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (blogger_id, platform_video_id)
);
CREATE INDEX IF NOT EXISTS idx_videos_blogger_pub ON videos(blogger_id, published_at DESC);
```

`user_id` 口径与 pages/icons 表对齐(博主/分类是登录用户的个人订阅数据;区别于 changelog_snapshots 的全局公共镜像)。

**50 条窗口淘汰**:每次入库(首添补历史、轮询新增)后,同一事务内执行:

```sql
DELETE FROM videos WHERE blogger_id = ?1
  AND id NOT IN (SELECT id FROM videos WHERE blogger_id = ?1 ORDER BY published_at DESC LIMIT 50);
```

## 后端架构

新领域模块 `backend/src/videoUpdates.ts`(照 `changelog.ts` 单文件范式:路由 + 服务 + 调度同文件),挂载 `app.route('/', videoUpdatesRoutes(...))`。

### 调度(独立于更新日志通道——资源面与节奏都不同:本模块是 YouTube/B站 HTTP + Cookie 凭据、1h/轮;那边是 LLM 网关 + npm/GitHub、6h/轮)

- cron:`schedule('23 * * * *', …)` 每小时 23 分轮询全量博主(非整点,避开整点请求高峰)。
- 通道:模块级 promise 尾链(照 changelog `exclusive()` 范式),两类任务共用:
  1. **全量轮询**(cron 触发):遍历博主。YouTube 博主间无间隔;B站 UP 间 `sleep(5s + rand*10s)`(5–15s 错峰),同 UP 首添翻页之间 sleep 5s。
  2. **首添即时首取**(添加博主投递):单博主补历史任务,进同一条链排队——不阻塞添加请求、不待下个整点、天然串行错峰。
- 失败与降级(票据 03 四项,重申为实施口径):
  - 单轮单博主失败:`console.error` + `fail_streak++`,等下一轮,**严禁小时内密集重试**。
  - `fail_streak >= 24`(连续 1 天)→ `status='failing'`,管理 tab 标红「取数失败」;下次成功清零回 `'ok'`(凭据补齐即自愈,无需显式「重试」端点)。
  - 停更博主:照常轮询,无特殊语义。
  - 入库即快照,不回删。

### YouTube 取数

| 场景 | 有 YOUTUBE_API_KEY | 无 key(降级) |
|---|---|---|
| 主页 URL → channel_id | `/channel/UC…` 直读;`@handle`/`/user/` 走 `channels.list` 对应参数(1 单位);`/c/name` 无 API 参数,抓页面 canonical | 非 `/channel/` 形态一律抓频道页 `<link rel="canonical">`(1.6MB 一次性,三形态实测均有) |
| 博主元信息 | 同一次 `channels.list part=snippet` 带回名称+头像三档 | 页面 `og:title` + `og:image`(900×900) |
| 首添 50 条历史 | UC→UU 推导(channel_id 第二位 C→U),`playlistItems.list maxResults=50`(1 单位)+ `videos.list` 批量补时长(1 单位);缩略图取 `snippet.thumbnails`(medium 320×180 优先) | RSS feed(15 条,hqdefault 480×360,无时长) |
| 每轮增量 | RSS feed(26KB,免 key 零配额)比对 videoId;新条目攒批 `videos.list` 补时长(1 单位/批) | 同左,但新视频无时长(不攒批) |

- RSS 端点:`https://www.youtube.com/feeds/videos.xml?channel_id=UC…`,CDN 缓存 15min < 1h 轮询间隔,不漏视频。
- RSS 解析:推荐 `fast-xml-parser`(小依赖、结构稳);entry 取 `yt:videoId`、`title`、`link`、`published`、`media:group>media:thumbnail`(shorts 的 link 是 `/shorts/<id>` 形态,原样存)。
- 时长解析:API `contentDetails.duration` ISO 8601(`PT15M33S`)→ 秒。
- 无 key 存量不回补:key 到位后新视频自然带全,老视频维持缺省(回补逻辑明确不做)。

### B站取数(全部走 wbi 签名;游客态已实测判死,一律带登录 Cookie)

- 主页 URL → mid:`space.bilibili.com/{mid}` 路径数字直读(认 `/{mid}`、`/{mid}/video`、`/{mid}/upload` 变体;`www.bilibili.com/space/` 形态 404 不支持)。
- 博主元信息:`/x/space/wbi/acc/info`(**匿名即稳**,添加请求同步调)→ `name`/`face`。
- 视频:`/x/space/wbi/arc/search`(`mid`/`order=pubdate`/`pn`/`ps`),带完整登录 Cookie;**顺手附 dm_img 假指纹与 `platform=web` 参数**(零成本贴近生态形态,稳定性依据仍是 Cookie)。字段:`title`/`bvid`/`pic`(http→https 改写后存)/`length`("MM:SS",超 1h 为 "H:MM:SS" 形态,解析成秒)/`created`(unix 秒)。
- 首添 50 条:`pn=1..2`、`ps=30` 各一次,页间 sleep 5s,入库后裁 50。
- 每轮增量:`pn=1 ps=30`(30 条 > 1h 窗口增量),比对 bvid。
- wbi 签名:`GET /x/web-interface/nav` 取 img_key/sub_key(**匿名可用**,按日缓存刷新)→ 拼接后按 `MIXIN_KEY_ENC_TAB`(64 项索引表,硬编码)重排取前 32 位 = mixin_key;`wts` = unix 秒,参数(含 wts)按键名升序、value 过滤 `!'()*` 拼 query,`w_rid = md5(query + mixin_key)`。算法细节与索引表见 [research/bilibili.md §1](research/bilibili.md)。
- Cookie 失效(code -101 / HTTP 403/412):按普通单轮失败处理(fail_streak++),日志提示人工换 Cookie——运维流程:重提 Cookie → 更新 `.env` → 重启容器(票据 06 完成时把换新流程记档)。

### 降级汇总(凭据缺失不堵功能)

| 缺失 | 行为 |
|---|---|
| 无 `YOUTUBE_API_KEY` | YouTube 博主照常可添加(页面解析元信息+头像),历史仅 RSS 15 条、无时长;key 到位后新视频自然带全 |
| 无 `BILIBILI_COOKIE` | B站博主照常可添加(acc/info 匿名稳);arc/search 首轮起失败,24h 后标红;Cookie 到位后自动恢复 |

## API 路由(前缀 `/api/video-updates`,须登录;响应类型入 shared 包,对齐 ADR-0018)

| 方法与路径 | 语义 |
|---|---|
| `GET /videos` | 全量视频(扁平 join 行:id/title/url/thumbnailUrl/durationSeconds/publishedAt/bloggerId/bloggerName/platform/categoryId),`published_at DESC`。量级 ≤500 条(10 博主×50),一次全量返回;tile 与 Modal 共用,分类过滤在前端 |
| `GET /categories` | 分类列表(sort_order 序)+ 各分类博主数 + 未分类博主数 |
| `POST /categories` `{name}` | 新建 |
| `PUT /categories/reorder` `{ids}` | 整序 |
| `PUT /categories/:id` `{name}` | 改名 |
| `DELETE /categories/:id` | 删除,博主经 ON DELETE SET NULL 回未分类 |
| `GET /bloggers` | 管理用博主列表(status 供「取数失败」标红) |
| `POST /bloggers` `{url}` | **同步**:解析 URL → 平台博主标识 + 元信息 → 入库(归未分类)→ 返回博主行;**异步**:投递首添补历史。错误(4xx 带 message):URL 非主页链接(watch/video 页)/平台不支持/已是重复博主 |
| `PUT /bloggers/:id` `{categoryId\|null}` | 改分类 |
| `DELETE /bloggers/:id` | 删除,视频级联删 |

## 前端 UI

### 图标类型注册

单例、`size: {w:3, h:2}`、`detailEntry: 'header'`(3×2 滚动大 tile 的「更多」标头入口范式,ADR-0022)、`data: null`(无可绑实例参数,照 aihot/todo 单例范式)。类型字面量按注册表现有命名风格取。

### Tile

- 标头:「视频更新」+ `MoreButton`(复用组件)开详情 Modal,整块点击无操作。
- 块内:单列滚动混合视频流。行 = 红点(24h,有则显示)+ `博主名 · 相对时间` 一行 + 标题一行截断 + 平台小标记;点行外跳原平台(新标签)。**缩略图不上 tile**。
- 渲染上限:**前 30 条**(对齐 ADR-0022「tile 榜单只渲染前 30 版」先例,看更早走 Modal)。
- 滚动主体消化滚轮、到边即停、不链式翻页(ADR-0021 注记口径)。
- 空状态(无博主):居中引导「在详情『管理』中添加博主」。

### Modal(照 aihot/todo Modal 范式)

- Tab 序:**全部**(默认,混合时间流)→ **未分类**(仅当桶内有博主)→ **各分类**(sort_order)→ **管理**。
- 视频条目(全部/分类 tab):缩略图(16:9,`referrerpolicy="no-referrer"`——B站 hdslb 防盗链实测自家域 Referer 必 403、no-referrer 200)+ 右下时长角标(无时长则无角标)+ 标题两行截断 + `博主名 · 相对时间`;24h 红点同 tile;整条外跳原平台。
- 管理 tab:
  - **分类区**:列表(名 + 博主数 + ↑/↓ 按钮整序——比画布拖拽范式更贴 Modal 行内场景)+ 新建输入框 + 改名 + 删除(确认提示「博主将归入未分类」)。「未分类」不在列表。
  - **博主区**:列表(头像/占位 + 名 + 平台标记 + 所属分类下拉(未分类+各分类) + `status='failing'` 标红「取数失败」 + 删除(确认))。添加:URL 输入框 + 提交,错误内联显示。
- 数据拉取:React Query,staleTime 5 分钟;Modal 打开时 refetch(取数延迟容忍 1h,无需更激进)。

## 凭据与部署

- `.env` 两键:`YOUTUBE_API_KEY`(可空,降级见上表)、`BILIBILI_COOKIE`(可空;**完整登录 Cookie 单串**,分号分隔,非仅 SESSDATA)。
- compose **必须**同步加 `${YOUTUBE_API_KEY}` / `${BILIBILI_COOKIE}` 引用行(.env 加键 ≠ 容器拿到值,透传暗坑)。
- 配额余量:YouTube 每博主首添 2–3 单位 + 每新视频批 1 单位,日 10,000 配额下数千频道级余量,无需监控告警。

## 明确不做(out of scope,map 已锁)

通知推送、站内播放/预览、订阅列表导入、互动数据展示、第三平台(抖音/微博)。数据模型带 platform 字段但不为第三平台预建抽象。

B站订阅量级按 ≤10 UP 设计(1h/轮 × N 连发的单 Cookie 风控面);量级显著增长时重估错峰参数与博主数上限。
