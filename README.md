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
后端首启需 `ADMIN_PASSWORD` 环境变量（建管理员）；数据库连接见 `.env.example`。

## 生产部署（Docker）
三容器：Caddy（含前端构建 + 自动 HTTPS + 反代 `/api`）+ backend + mysql。
```bash
cp .env.prod.example .env.prod        # 填 DOMAIN / ADMIN_PASSWORD / DB_* 真实值
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```
前提：域名 A 记录指向 VPS 公网 IP、80/443 开放——Caddy 据此自动签 Let's Encrypt 证书。
`mysql_data` 卷持久化数据库；backend `SPRING_PROFILES=prod`（cookie secure、容器内 8080、datasource 走 `mysql:3306`）。

## 进度（plan）
✅ M1 工程骨架 → ✅ M2 鉴权闭环 → ✅ M3 导航磁贴 + 聚合 config → ✅ M4 股票行情磁贴 → ✅ M5 更新日志磁贴 → ✅ M6 主题/时钟/搜索 → ✅ M7 生产部署。
