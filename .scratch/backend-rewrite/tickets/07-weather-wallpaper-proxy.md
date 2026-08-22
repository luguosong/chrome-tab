# 07 — weather/wallpaper 代理与缓存

**What to build:** ADR-0009 语义照搬。weather 批量端点:重复 `location` 参数整串为键(不拆逗号)、非法静默跳过;内存 TTL 缓存(实况 10min/空气 30min/预警 5min)仅缓存成功结果;降级分级:实况失败整 bundle null、空气/预警各自降级不影响实况;原始串键与规范化键并存照契约。外呼防御:gzip 解压后摘除 Content-Encoding/Content-Length 头;URL 裸主机前置 `https://`;解析失败明确 fallback 不抛错。wallpaper:代理必应 HPImageArchive、拼完整图 URL、缓存按 enddate 天失效(失败沿用旧值,修正白名单第 3 项)。天气 Key 未配置 → 500「服务器错误」。

**Blocked by:** 04 — auth。

**Status:** done(2026-08-22,commit 见 backend-rewrite 分支)

- [x] 批量端点原始串键与规范化键并存的响应形状照契约,非法项静默跳过
- [x] 实况失败整 bundle null;空气/预警各自降级不影响实况(分级降级断言)
- [x] TTL 缓存生效且失败结果不被缓存
- [x] wallpaper 按天换新:enddate 变化才重拉,失败沿用旧值(修正③ positive+negative)
- [x] Key 未配置返回 500「服务器错误」
