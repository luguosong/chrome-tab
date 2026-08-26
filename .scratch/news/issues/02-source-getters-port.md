# 02 源抓取函数移植(16 源)

Status: resolved

backend/src/news/sources/*.ts:每源一个抓取纯函数(移植自 newsnow main,MIT,保留版权注记);统一 UA/10s/重试;weibo Cookie、cls 签名复刻。解析函数带 fixture 测试(JSON 热榜/HTML/RSS/签名四类各至少一)。详见 spec.md「定案」抓取节。
