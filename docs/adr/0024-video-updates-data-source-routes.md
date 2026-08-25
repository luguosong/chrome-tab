# 视频更新取数路线:YouTube「RSS 轮询 + API 按需」、B站「小号 Cookie 直打 wbi」

背景:双平台都没有「官方、免凭据、字段全」的取数口。实测事实(`.scratch/video-updates/research/`,2026-08-25):YouTube RSS 免 key 零配额但每频道仅 15 条、无时长无头像;Data API 配额无忧(日 10,000、list 类 1 单位/次)但需 key。B站无官方公开 API,游客态打投稿列表接口实测抽签式判死(匿名/游客 Cookie 连发 2–3 次即 412/-352 风控、IP 级冷却不自愈),RSSHub 公共实例 Cloudflare 403、自建同源风控且 XML 缺时长。

**决策:YouTube 用官方 RSS 做 1h 轮询的零配额变更检测,Data API 只在首添(补满 50 条历史 + 头像,2–3 单位/频道)与检出新视频(批量补时长,1 单位/批)时按需调用;B站用专用小号完整登录 Cookie 直打 `/x/space/wbi/arc/search`(wbi 签名自实现,UP 间 5–15s 随机错峰),博主元信息走匿名即稳的 acc/info。**

Rejected alternatives 值得记:纯 RSS(15 条 < 50 窗口、缺时长头像);纯 API(~416 频道配额天花板,无谓消耗);B站 APP 端免认证接口(文档口径已失效,实测 -400);RSSHub(同接口同风控、多常驻容器、缺时长)。降级口径:两凭据均可缺——无 key 时 YouTube 博主仍可添加(RSS 15 条、缺时长头像),无 Cookie 时 B站博主标红待自愈;B站订阅量级按 ≤10 UP 设计,显著增长须重估错峰参数。小号封号 = 重注册换 Cookie,不涉社交资产。
