# 03 轮询调度 + REST 路由 + 契约测试

Status: resolved

backend/src/news/news.ts(照 videoUpdates.ts):NewsService(勾选集替换、尾链首取、cron 11,41 轮询、48 轮 failing、裁剪 50)+ GET /api/news/feed / PUT /api/news/sources;app.ts/index.ts 接线;icons.ts NEWS 镜像。testUtils 契约测试。详见 spec.md「定案」调度/REST 节与「测试」节。
