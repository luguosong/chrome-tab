# 06 - Task: B站小号注册与 Cookie 提取

Type: task
Status: open

## Question

为票据 03 定死的「小号 Cookie 直打 wbi」路线备妥凭据（人工操作为主，HITL）：

1. 注册一个 B站小号，**仅作取数用途**（封号 = 重注册，不心疼;勿用主号——账号线暴露给风控）。
2. 浏览器登录小号后提取**完整 Cookie**（SESSDATA、buvid3、buvid4、bili_jct 等全量——研究口径「完整登录 Cookie,不是只有 SESSDATA」,bilibili.md §1）。
3. Cookie 落位:`.env` 加 `BILIBILI_COOKIE_<形态待 spec 定>` 键,并确认 deploy compose 有对应 `${…}` 引用行（同透传暗坑）。
4. 验证:带该 Cookie 调一次 `/x/space/wbi/arc/search`（wbi 签名按 bilibili.md §1 算法）,拿到 code 0 全量 vlist 即完成。

完成记录:Cookie 所在 .env 键名、实测 mid 样本与返回 gist;另记一句换新流程（Cookie 失效 = 重复第 2–3 步）供 spec 写运维口径。

注:与票据 04 并行，不互相阻塞。
