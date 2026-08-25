# 03 - 选型决策：数据源与轮询方案

Type: grilling
Status: resolved
Blocked by: 01, 02

## Question

基于票据 01（YouTube）与 02（B站）的研究事实，与用户 grill 定死：

1. **YouTube 路线**：纯 RSS、纯 Data API、还是「RSS 轮询 + API 补历史」组合？（50 条保留窗口 vs RSS 15 条窗口是关键张力；若需 API key 则先开 task 票据）
2. **B站路线**：wbi 接口直打还是 RSSHub 兜底？若必须 Cookie，用户是否愿意提供（挂 task 票据）？
3. **轮询间隔定值**：在「1 小时延迟容忍」（map Notes 第 8 条）与研究出的风控/配额约束之间定值；若 1 小时不可达，与用户重议容忍度。
4. **失败与降级**：接口偶发失败的重试策略、博主停更/删号的展示语义（spec 要写，先在这里定方向）。

解决时须把每条决策的依据（对应研究文件的事实行）一并记录，供票据 04 直接引用。

## Answer

2026-08-25 与用户 grill 定死,四问全按推荐（研究依据行号指向 [`../research/youtube.md`](../research/youtube.md) 与 [`../research/bilibili.md`](../research/bilibili.md)）：

**1. YouTube = RSS 轮询 + API 按需补**
- 轮询用官方 RSS（0 配额;CDN 15 分钟缓存 < 1h 间隔不漏视频,youtube.md §6）;首添一次性 API 补满 50 条历史 + 头像（2–3 单位/频道,youtube.md §5）;轮询检出新视频时 `videos.list` 补时长（1 单位/批）。
- 依据:Modal 已定显示时长与博主头像（map Notes 第 7 条）,而 RSS 无任何时长字段、author 仅名+URL（youtube.md §1）;watch 页解析 1.6 MB/视频不可行（youtube.md §3）。配额侧日 10,000 单位下本路线消耗数千频道级余量（youtube.md §6）。
- 衍生:票据 05（API key 申请）。

**2. B站 = 小号登录 Cookie 直打 wbi 接口**
- 本票会话内新增实测:APP 端 `app.biliapi.com/x/v2/space/archive/cursor` 文档口径「无需认证」已失效——照文档示例参数 + APP UA,`app.biliapi.com`/`app.bilibili.com`/`api.bilibili.com` 三 host 均 -400（要求 APP 签名）,备查路线判死。
- RSSHub 自建弃:同接口同源风控、XML feed 缺时长、多常驻容器,处处劣于直打（bilibili.md §6）。字段:`length` "MM:SS" 字符串、`created` unix 秒、`pic` 全量（bilibili.md §1）。
- 风险控制:专用小号（封号=重注册,无社交资产损失）;Cookie 失效（改密/异地登录）后人工换新。
- 衍生:票据 06（小号注册与 Cookie 提取）。

**3. 轮询 = 双平台统一 1h/轮;B站 UP 间随机 5–15s 错峰,YouTube 直连**
- 1h/轮 = map Notes 第 8 条延迟容忍的依据;YouTube RSS 无风控压力无需错峰（youtube.md §6）;B站错峰依据「同接口短时间被同 IP 多次请求即触发」（bilibili.md §1 风控口径）。首添补历史的特殊节奏按一次性低频处理,归票据 04 细化。

**4. 失败与降级四项**
- 单轮失败只记日志等下一轮（轮询即天然重试）;**严禁小时内密集重试**——B站连发即风控（bilibili.md §1 实测时间线）。
- 连续 24 轮（1 天）失败 → 博主标记异常,管理 tab 标红「取数失败」,不自动删除（接口抽风 ≠ 删号,误删不可逆）。
- 停更博主无特殊语义:照常轮询,视频流自然停在旧视频。
- 视频入库即快照,不回删（后续被删的视频照旧展示,滚动 50 条窗口自然淘汰）。
