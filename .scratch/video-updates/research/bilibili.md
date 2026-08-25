# B站数据源可行性事实(票据 02)

查证日期 2026-08-25。实测环境:WSL 国内直连(勿代理),UA = Chrome/126 Windows;文档信源见下。本文只钉事实,不做选型(选型是票据 03)。

## 0. 信源状况(先读)

**SocialSisterYi/bilibili-API-collect 原仓库已死**:2026-01-28 维护者收 B站委托律师函,即日起停止维护并删除文档源码,默认分支已改 `deprecated`。本文引用的文档内容取自删除前的社区 fork 镜像:

- 停服声明: https://github.com/SocialSisterYi/bilibili-API-collect/blob/deprecated/README.md
- 主镜像(本文 docs 引用基准): https://github.com/rinnein/bilibili-API-collect (2026-01-31 停更快照)
- 备份: https://github.com/BACNext/bilibili-API-collect-backup ;Wayback 佐证: http://web.archive.org/web/20251114043314/https://github.com/SocialSisterYi/bilibili-API-collect/blob/master/docs/misc/sign/wbi.md

后果:文档是快照,B站接口随时可能再变;实测结果比文档新,冲突时以实测为准。

## 1. 投稿列表接口 `/x/space/wbi/arc/search`

### wbi 签名(文档: docs/misc/sign/wbi.md,镜像)

1. `GET /x/web-interface/nav` 取 `data.wbi_img.img_url / sub_url`,URL 文件名去 `.png` 即 img_key/sub_key。**未登录(code -101)照样返回** [实测:匿名 200 直出,0.13s]。key 每日更替,需缓存刷新。
2. `raw = img_key + sub_key`(64 字符),按 64 项重排索引表 `MIXIN_KEY_ENC_TAB` 取对应位置字符,截前 32 位 = mixin_key。索引表:
   ```
   46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,
   29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,
   22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52
   ```
3. `wts` = unix 秒;参数(含 wts)按键名升序拼 query(value 过滤 `!'()*`,`encodeURIComponent` 风格),`w_rid = md5(query + mixin_key)`,追加到请求。签名错误典型返回 `v_voucher` / -352。
4. 实测验证:按此算法匿名调 `/x/space/wbi/acc/info` 稳定 code 0——签名算法现行有效。

### 参数与分页(文档: docs/user/space.md「查询用户投稿视频明细」)

- 参数:`mid`(必要)/ `order`(pubdate|click|stow,默认 pubdate)/ `tid`(0=不筛)/ `keyword` / `pn`(默认1)/ `ps`(默认30)。
- 分页:**纯 `ps/pn` 页码式,无 offset 游标**;返回 `data.page = {count 总稿件数, pn, ps}`。

### 字段覆盖(文档 + 实测样本一致)

vlist 每项:`aid` `bvid` `title` `pic`(封面 URL) `description` `play` `comment` `video_review`(弹幕) `typeid` `author` `mid` `is_union_video` `meta`(合集) 等。**没有 `duration` 字段——时长字段名是 `length`,str 类型,格式 "MM:SS" 字符串**;**`created` 是 unix 秒时间戳**。实测成功样本(mid=2267573):

```json
{"title":"欧洲旅游VLOG | ...","pic":"http://i2.hdslb.com/bfs/archive/5122d721....jpg",
 "created":1766234910,"length":"24:39"}
page: {"pn":1,"ps":3,"count":34}
```

注意 `pic` 返回 **http:// 协议**,https 页面下有 mixed-content 风险;实测同路径 https 直连可用,取数侧改写协议即可。

### Cookie 与风控(核心实测,2026-08-25)

匿名游客态打该接口是**「抽签式」,不可稳定**。当日同一 IP、同一 UA 的完整时间线:

| 尝试 | 形态 | 结果 |
|---|---|---|
| 纯匿名无 Cookie | 412 + HTML(「出错啦!」验证码页) / 200 + `-352 风控校验失败` 带 `v_voucher` | 拦截 |
| finger/spi 取 buvid3+buvid4 | 200 + `-352` | 拦截 |
| 访问 www 主页落 buvid3+b_nut | 首发仍 412;**随后一次成功**(mid=2267573 拿到全量数据) | 偶过 |
| 成功后数分钟,同 Cookie 复打 | 412 HTML、`-412 request was banned`、`-352` 交替 | 拦截 |
| 间隔 90s 复打 | 412 HTML | 拦截 |
| **全新** Cookie 主页重落 + 立即单发 | 412 HTML | 拦截 |

结论:游客 Cookie(哪怕新鲜)只能偶发通过,连续 2-3 发即触发;**触发后为 IP 级冷却,换新 Cookie 无效,90s 内未恢复**(未测更长)。文档侧无量化阈值,只有「同接口短时间被同用户/IP/UA 多次请求即触发」的定性口径(docs/misc/sign/v_voucher.md);错误形态:-352(响应头 `x-bili-gaia-vvoucher`)、-412、HTTP 412 验证码页(geetest 滑块,可走 gaia-vgate 换 vtoken 但「不是所有风控都能过」)。**稳定使用的既知路径 = 登录态 Cookie(SESSDATA 等)**——RSSHub 维护者原话「完整 Bilibili 登录 Cookie,不是只有 SESSDATA」。

文档另记一条 APP 端替代:`https://app.biliapi.com/x/v2/space/archive/cursor`,「APP 端请求对 web 端包容度最高,无需 Cookie 以外的任何认证,只需 vmid」,游标式翻页(`aid` 续传 + `has_next`)。未实测,仅记录存在。

## 2. UP 主元信息 `/x/space/wbi/acc/info`

- 文档(docs/user/info.md):要求 wbi 签名 + 「Cookie(SESSDATA 与空值的总项数 ≥3)」;错误码 -400/-403/-404,-352=风控。
- **实测与文档不符,宽松得多:匿名 + wbi 签名即通**,不带任何 Cookie 也 200 code 0(返回 mid/name/face/sign/level 等),带游客 Cookie 同样通,当日 4+ 次调用全部成功、无风控。昵称头像场景零 Cookie 成本。
- 旧版 `/x/space/acc/info` 已废弃,用 wbi 版。

## 3. mid 解析

- `space.bilibili.com/1234567` 路径里的数字**就是 mid,与 uid 同义,无需换算**(文档全部接口的 mid 即「目标用户 mid」,Referer 惯例 `https://space.bilibili.com/{mid}/`;RSSHub radar 规则 `space.bilibili.com/:uid` 直接把路径参数当 uid 用)。
- 实测变体:`/{mid}`、`/{mid}/video`、`/{mid}/upload` 均 200 直出;`www.bilibili.com/space/{mid}` 实测 404(该形态当前不存在,解析时不必支持)。

## 4. 缩略图 CDN(hdslb.com)防盗链

实测(头像 i0 与封面 i2 两个子域,行为一致;2026-08-25):

| 请求 Referer | 结果 |
|---|---|
| 无(no-referrer) | **200** |
| `https://www.bilibili.com/` | 200 |
| `https://tab.luguosong.cn/`(自家域) | **403** |
| `https://www.baidu.com/` | 200(黑名单制,非白名单制) |

结论:**前端 `<img referrerpolicy="no-referrer">`(或全局 meta)直连可行,不需要后端代理图床**;但绝不能带自家域 Referer 裸加载。另:`pic` 字段给的是 http://,https 直连已验证 200,展示前改写协议。

## 5. 轮询耐受(1h/轮 × N 个 UP)

- `arc/search`:游客态按上表实测,连续 2-3 发即 412/-352 且 IP 级冷却——**1h/轮 × N≥3 的节奏在游客态不可行**,N 个 UP 连续串行就是 N 连发。稳定路线需要完整登录 Cookie(账号线暴露给风控,被封是账号代价)。
- `acc/info` / `nav`:当日十余次匿名调用全通,风控面显著更松,昵称头像可放心轮询。
- 恢复形态:412 验证码页 = geetest 滑块(人工/半自动,「不是所有风控都能过」);实测 90s 内未自愈,更长冷却时长未测;无「申请解封」通道,只能等或换出口 IP。

## 6. 替代路线:RSSHub

(源码为证: DIYgod/RSSHash `lib/routes/bilibili/video.ts`、`cache.ts`、`config.ts`;issues #13985、#19633)

- 路由:`/bilibili/user/video/:uid/:embed?`,**只取第 1 页 30 条、不翻页**(增量轮询场景恰好够用)。
- 实现:内部就是调同一个 `/x/space/wbi/arc/search`(附加 dm_img/render data 参数,wbi 表运行时从 `bili-header.umd.js` 抽取),API 失败 fallback 到 Playwright 真浏览器访问 space 页拦截响应。
- Cookie:路由定义不强制配置;未配 `BILIBILI_COOKIE_{uid}` 时用 Playwright 打开 space 页**隐式收集匿名 Cookie**(即隐含依赖 Puppeteer 能力);要稳定则配完整登录 Cookie。风控面与直打同源——RSSHub 不是绕风控,只是把风控应对工程化了。
- 输出字段:`title` / `description`(封面+简介+内嵌播放器)/ `pubDate` = RFC 1123 UTC 字符串 / `link` = `bilibili.com/video/{bvid}` / `author`。**时长不在 RSS XML 字段里**:解析 B 站 "MM:SS" 后放 `attachments[].duration_in_seconds`(秒),且 attachments 仅 JSON feed 透出——XML feed 消费方拿不到时长。
- 公共实例 `rsshub.app`:**实测直连 403 Cloudflare「Just a moment…」人机盾**(服务端取数不可用);issue #13985 实证公共实例上该路由报 -352。公共实例路线判死。
- 自建成本:一个 docker 容器;匿名跑 = 体积/资源被 Playwright 撑大且仍不稳,配登录 Cookie = 小号账号线入场。

## 结论:票据 03 可判的对比表

| 维度 | wbi 直打(游客) | wbi 直打(登录 Cookie) | RSSHub 自建 | RSSHub 公共实例 |
|---|---|---|---|---|
| 投稿列表字段 | `length` "MM:SS" 需自解析;`created` unix 秒;title/pic/bvid/play 全量,可控性最高 | 同左 | XML feed **无时长字段**(仅 JSON feed attachments 秒数);pubDate RFC1123;描述混内嵌播放器 HTML | 同自建 |
| Cookie 需求 | buvid3/b_nut 实测不够 | SESSDATA 等完整登录 Cookie | 不配则隐式依赖 Playwright;配则 BILIBILE_COOKIE_{uid} | 无法配置 |
| 风控面 | **实测连续 2-3 发即 412/-352,IP 冷却,游客态判死** | 1h/轮低频大概率稳,但代价=账号凭据 | 同 wbi 直打(同一接口),多浏览器指纹兜底层 | 实测 CF 盾 403,判死 |
| 昵称/头像 | acc/info 匿名即稳(已实测),任一方案都零成本独立取 | 同左 | 路由内自带 | — |
| 缩略图 | 前端 no-referrer 直连 hdslb 可行(实测),pic 需 http→https 改写;自家域 Referer 必 403 | 同左 | 同左 | 同左 |
| 轮询成本 | 不可行 | 每轮 N 次签名请求 + nav key 日更缓存 | 额外自托管容器 + RSS 解析,字段还要二次抓接口补 | 不可用 |
| 工程量 | 最小(一个签名函数) | 同左 + 凭据管理 | 一个常驻服务 | 零 |

一句话:游客态匿名直打投稿列表已被实测判死,真正可判的分叉是「登录 Cookie 直打(工程最小、字段最全)」vs「RSSHub 自建(工程较重、XML 缺时长)」;acc/info、mid 解析、缩略图直连三条腿任何方案下都是免费的。另有一条未实测的 APP 端 `app.biliapi.com/x/v2/space/archive/cursor`(文档称无需认证、游标翻页)可作为票据 03 的备查项。

## 7. 补充查证:生态库路线(2026-08-25,票据 03 定稿后)

用户问及 `public-clis/bilibili-cli`(⭐995)是否有助。查证结论:**无新取数方案,不改变选型**;但牵出的上游库事实值得记档:

1. **bilibili-cli 是 `bilibili-api-python`(Nemo2011,PyPI 17.4.2)的薄封装**——取投稿列表完全委托上游库,自身无风控对策。
2. **上游库同样调 `/x/space/wbi/arc/search`**,但在 wbi 签名外附加两层风控对抗参数:
   - `dm_img_list/dm_img_str/dm_img_inter`:浏览器指纹,**实为硬编码假指纹**(空操作记录 + 随机两字符,`utils/network.py:1944-1947`)。
   - `w_webid`(aka access_id):JWT 格式,原设计从 `space.bilibili.com/{mid}/dynamic` 页面 `<script id="__RENDER_DATA__">` 抠取并按 JWT `iat+ttl` 缓存(`utils/user_render_data.py`)。
3. **w_webid 链路已对新版页面失效**:实测匿名抓 space/dynamic 返回 200 真实页面(10 KB,title 正常),但页面是纯客户端渲染 SPA——`access_id`/`eyJ`/`__RENDER_DATA__` 零出现,仅有空占位 `<meta name="web-render-data" />`。上游库此路径 strict=False 下返回 None,匿名取数退化为「裸调 arc/search + 假指纹」,即 §1 已判死的形态。用真浏览器拦截 XHR 换取 w_webid 理论可行,但那等同 RSSHub 的 Playwright 兜底路线(重、匿名态同样受风控约束,§6)。
4. **上游库的稳定用法 = Credential(SESSDATA/buvid3/bili_jct 等完整 Cookie)**——与票据 03 已定的「小号 Cookie 直打」同构,佐证选型。
5. 实施提示:我们的 wbi 直打可顺手带上 dm_img 假指纹与 `platform=web&order_avoided=true` 参数(零成本,更贴近生态形态),但稳定性依据仍是 Cookie,不指望这些参数。
