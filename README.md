# chrome-tab

个人浏览器新标签页：网站快速导航 + 股票行情 + Claude Code 更新日志。前后端分离（React + Hono/Node），私人登录，Docker 部署。数据为单文件 SQLite（WAL），无外部数据库（Java + MySQL 旧栈已于 2026-08 下线，见 [ADR-0019](docs/adr/0019-backend-node-sqlite-rewrite.md)）。

## 结构
- `frontend/` — React 18 + TS + Vite + Tailwind v4
- `backend/` — Hono + TS + better-sqlite3（Kysely 查询构建），pnpm workspace
- `shared/` — 前后端共享契约类型
- `extension/` — Chrome 新标签页重定向扩展（纯静态，无构建）
- `prototype/` — 早期单 HTML 原型（参考，不部署）

## 本地开发
```bash
pnpm install                                   # 根一次装全 workspace

# 后端（终端 1）：PORT=8082 对齐 vite 代理；首启需 ADMIN_PASSWORD
cd backend && PORT=8082 ADMIN_PASSWORD=dev pnpm dev

# 前端（终端 2）
cd frontend && pnpm dev                        # :5173，代理 /api → :8082
```
浏览器打开 http://localhost:5173 。数据落在 `backend/data/newtab.db`（SQLite 文件，删库 = 重置）。

## 测试
```bash
pnpm -r test          # 全 workspace（backend vitest + frontend vitest + extension node --test）
pnpm -r typecheck
```

## Chrome 扩展（新标签页接管）
薄重定向扩展：接管新标签页并跳转到目标页 URL（默认 `http://localhost:5173`），不打包前端、对页面 origin 零侵入——取舍见 [ADR-0010](docs/adr/0010-newtab-thin-redirect-extension.md)。
```bash
node --test extension/config.test.mjs   # 唯一测试：URL 校验纯函数
```
加载：`chrome://extensions` → 开发者模式 → 「加载已解压的扩展程序」→ 选 `extension/` 目录。
改目标页（如迁移远程域名后）：点工具栏扩展图标，popup 里改 URL 保存，下一个新标签页生效。

## 生产部署（Docker）
两容器：Caddy（含前端构建 + 自动 HTTPS + 反代 `/api`）+ Node backend（SQLite）。
```bash
cp .env.prod.example .env.prod        # 填 DOMAIN / ADMIN_PASSWORD / API Key 真实值
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```
前提：域名 A 记录指向 VPS 公网 IP、80/443 开放——Caddy 自动签证书（ZeroSSL 优先、Let's Encrypt 兜底，证书持久在 `caddy_data` 卷）。
数据在 `./backend/data` 下的 SQLite（WAL）；备份每日 `VACUUM INTO` 落 `backend/data/backups`，恢复 = 拷回文件。
线上发布走 `.claude/skills/deploy`（镜像本地构建、save|ssh 传输、compose 重启）。
