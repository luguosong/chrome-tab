# 新闻(单例图标类型)实现 spec

> 定案出处:2026-08-26 grill 三轮问答 + 海外可达性实测(mihomo 美西出口,16/16 全可达)。
> 架构决策:ADR-0027(源定义移植 newsnow + cron 预取落库);范式:ADR-0021/0022(3×2 大 tile + 「更多」唯一入口)、ADR-0023(持久化轮询,对齐视频更新)。
> 领域词条已入 CONTEXT.md(「新闻」「新闻源」)。

## 定案

- **类型**:扩展图标类型 `news`(wire 大写 `NEWS`),单例,`size 3×2`,`detailEntry: 'header'`,data 无字段。
- **内置「新闻源」枚举 16 个**(shared 契约,代码即配置;此前口径说 17 系笔误,按清单数):

  | 类别 | 源(id → 名) |
  |---|---|
  | 综合热点 | zhihu 知乎 · weibo 微博 · baidu 百度 · thepaper 澎湃 |
  | 科技 | ithome IT之家 · 36kr 36氪 · sspai 少数派 · solidot Solidot |
  | 开发者 | github GitHub Trending · hackernews Hacker News · v2ex V2EX · producthunt Product Hunt |
  | 财经 | cls 财联社电报 · wallstreetcn 华尔街见闻快讯 |
  | 中文外媒 | zaobao 联合早报 · cankaoxiaoxi 参考消息 |

- **抓取**:每源一个 `() => Promise<PortedNewsItem[]>` 纯函数,移植自 newsnow(main,MIT;文件头保留版权注记),统一 Chrome UA / 10s 超时 / 2 次重试。weibo 复刻硬编码游客 Cookie;cls 复刻动态签名(md5(sha1(sorted-params)))。**条目只保留 id/title/url/publishedAt?(unix 秒,null=热榜无逐条时间),newnow 的 extra.info/hover 不透传。**
- **调度**:cron `11,41 * * * *`(每小时 11/41 分,30min 周期、错开整点),轮询**已勾选**源;勾选变更即时投递新勾源首取(尾链串行,同 videoUpdates)。连续 48 轮失败标 `failing`(不自动删、不炸图标),成功即回 ok。
- **存储**(SQLite,账号级):

  ```sql
  CREATE TABLE news_sources (
      user_id INTEGER NOT NULL, source TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      fail_streak INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'ok',
      last_success_at TEXT, created_at TEXT NOT NULL,
      UNIQUE (user_id, source), FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE news_items (
      id INTEGER PRIMARY KEY, source TEXT NOT NULL,
      item_id TEXT NOT NULL, title TEXT NOT NULL, url TEXT NOT NULL,
      published_at INTEGER,  -- NULL = 上游无逐条时间(热榜)
      created_at TEXT NOT NULL,
      UNIQUE (source, item_id)
  );
  ```

  注意:news_sources 不做 user 级勾选之外的上游状态全局化——轮询按用户×源独立(个人单账号部署,重复抓取面可忽略;首个勾选该源的用户触发抓取,同轮覆盖所有勾选者)。裁剪:每源每轮入库后按 `id`(入库序)降序保留 50——新进榜/新发布条目 id 单调增,两种源(有/无逐条时间)同一口径;展示排序与裁剪解耦(见下)。

- **混合流排序**:`COALESCE(published_at, unix(created_at))` 降序——无时间条目以入库时间为代理。
- **UI**:
  - tile(NewsIconBody):BigTile(标题「新闻」)+ 全源混合单列滚动流(MAX 30 行);行 = `源名 · 相对时间(可缺)` + 24h 红点(仅有限时间条目)+ 标题截断;点行外跳。标头鲜度 = 源级最近成功抓取时间(多源取 max)。零勾选空态:「打开「更多」勾选新闻源」。
  - Modal(NewsModal):tab = 全部(默认)→ 各勾选源(动态)→ 管理。管理 = 16 源平铺复选清单(failing 标红注记),保存 = 整份 PUT 勾选集。
- **REST**:
  - `GET /api/news/feed` → `{ items: NewsItem[], sources: Array<{id, enabled, status, lastSuccessAt}> }`(items 含全部勾选源条目,排序见上;前端按 source 过滤出各源 tab)。
  - `PUT /api/news/sources` body `{sources: NewsSourceId[]}` → 整份替换勾选集,新勾源投递首取。
- **前端**:hook 自持(同 aihot/todo/video 先例,不入集中层):`useNewsFeed`(staleTime 5min)+ `useSetNewsSources`;registry 注册 `NEWS_DEF`;Icon/DashboardPage 各加一分发分支;后端 icons.ts:`ICON_TYPES` + `SINGLETON_TYPES` + `TYPE_SPANS`(NEWS: 6)。

## 测试

- 后端:解析纯函数 fixture 测试(每源类型至少 1:JSON 热榜/HTML/RSS/签名构造);路由契约测试(testUtils:勾选→首取(假 fetch)→feed 排序与 COALESCE、未勾选源不出现在 feed、PUT 替换勾选、48 轮 failing)。
- 前端:registry 纯函数(NEWS_DEF 元数据、iconCells('news')=6、canAdd 单例)。

## 不做(YAGNI)

- 源分类分组、extra.info 透传、已读概念、历史检索(>50 条)、用户自定义 RSS、前端直连、明文 HTTP 特判(cankaoxiaoxi 正常抓)。
