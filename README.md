# chrome-tab

个人浏览器新标签页：网站快速导航 + 股票行情 + Claude Code 更新日志。前后端分离（React + Spring Boot），私人登录，Docker 部署。

## 结构
- `frontend/` — React 18 + TS + Vite + Tailwind v4
- `backend/` — Spring Boot 3.4 + Java 21
- `prototype/` — 早期单 HTML 原型（参考，不部署）

## 本地开发
```bash
# 后端（终端 1）
cd backend && mvn spring-boot:run            # :8081

# 前端（终端 2）
cd frontend && npm install && npm run dev     # :5173，代理 /api → :8081
```
浏览器打开 http://localhost:5173 。

## 进度（plan）
✅ M1 工程骨架 → ✅ M2 鉴权闭环 → ✅ M3 导航磁贴 + 聚合 config → ✅ M4 股票行情磁贴 → ⬜ M5 更新日志磁贴 → ⬜ M6 主题/时钟/搜索 → ⬜ M7 生产部署。
