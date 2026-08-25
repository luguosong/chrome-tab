# 02 - Research: B站数据源可行性事实

Type: research
Status: resolved

## Question

为「视频更新」的 B站取数钉死事实基础（B站无官方公开 API，只查证、不选型——选型是票据 03 的事）。用高信源（社区文档如 bilibili-API-collect、实际请求验证）回答：

1. **投稿列表接口**：`/x/space/wbi/arc/search` 现状——wbi 签名怎么做、匿名可打还是必须带 Cookie（buvid3 等）、风控触发条件（频率阈值/IP 封禁形态）；返回字段是否覆盖：标题、缩略图、**时长**、发布时间（created 时间戳?）、分页方式。
2. **UP 主元信息**：昵称/头像接口（`/x/space/wbi/acc/info` 或替代）的签名与 Cookie 要求。
3. **mid 解析**：`space.bilibili.com/1234567` 形态的主页 URL 是否即 mid、有无其它 URL 变体需要解析。
4. **缩略图 CDN**：`hdslb.com` 的防盗链策略——前端 `<img>` 直连（no-referrer）能否加载，还是必须后端代理。
5. **轮询耐受**：1 小时/轮 × N 个 UP 主的节奏，匿名接口能否长期稳定；触发风控后的恢复形态（验证码? 解封?）。
6. **替代路线**：RSSHub（公共实例可用性/自建成本）作为兜底的可行性评估。

产出写 `.scratch/video-updates/research/bilibili.md`，结论段须直接给「票据 03 可判」的对比表。

## Answer

事实已钉死,详见 [../research/bilibili.md](../research/bilibili.md)。gist:

1. wbi 签名算法现行有效(nav 取 key → 索引表重排 → md5);`acc/info` 匿名即稳、`space.bilibili.com/{数字}` 即 mid、hdslb 图前端 no-referrer 直连可行(pic 需 http→https 改写)——这三条腿任何方案下免费。
2. **投稿列表 `arc/search` 游客态被实测判死**:匿名/游客 Cookie 均为抽签式,连续 2-3 发即 412(验证码页)/-352(v_voucher),IP 级冷却 90s+ 不自愈、换新 Cookie 无效;稳定路线只有完整登录 Cookie。
3. 字段关键点:时长字段是 `length`("MM:SS" 字符串,非秒非 duration),`created` 是 unix 秒,分页 ps/pn 页码式;RSSHub 的 XML feed 没有时长字段(仅 JSON feed),且公共实例 rsshub.app 实测被 Cloudflare 盾。
4. 票据 03 真正的分叉:**登录 Cookie 直打(工程最小、字段最全)** vs **RSSHub 自建(常驻服务、XML 缺时长)**;另记录一条未实测的 APP 端接口(`app.biliapi.com/x/v2/space/archive/cursor`,文档称无需认证)备查。
5. 信源警告:bilibili-API-collect 原仓库 2026-01 收律师函已删档,本文档事实取自 fork 快照 + 当日实测,后续接口可能再变。
