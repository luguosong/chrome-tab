# 12 — 切换日(big bang,一 session)

**What to build:** 按可照做的清单在一个 session 内完成,无临场决策、无回滚(失败向前修复):停旧 backend → 终版 mysqldump 纯文件存档(清毁数据卷前唯一保留物)→ 全量 ETL 重跑(秒级)→ 新 compose(无 mysql 段)up 起新容器 → `pnpm smoke` 冒烟:登录链路 + config/changelog/weather/wallpaper 各一探 + 401 探针。切换日本身需登录一次(sessions 载体更换);此后重启不再掉线。停机几分钟,无切换窗口。

**Blocked by:** 11 — 服务器 ETL 演练。

**Status:** done(2026-08-22,一个 session 内完成;下线约 40 秒:stop → dump → ETL 0.3s → up 1s → 证书重签窗口约 30s)

- [x] 终版 mysqldump 存档落地且校验可读(唯一安全网)—— 188 KB gzip;服务器 /opt/chrome-tab/mysql-final-20260822.sql.gz + 本地 ~/mysql-final-chrome-tab-20260822.sql.gz 双份;gunzip -t + `-- Dump completed` 校验
- [x] 新单后端容器 up,smoke 全部通过 —— 9/9(含 cookie 三属性断言;weather 首次 200,见下)
- [x] 现有账密原样可登,页面/图标/分组/布局设置分毫不动(对账零差异)—— ETL 7 表零差异 + config 探针 pages=3/icons=19 与演练基线一致 + 旧密码登录 200(bcrypt 原样)
- [x] 后端容器强制 GC 后 RSS 实测 ≤ ~100 MiB 档 —— /debug/gc 后 32.5 MiB(caddy 15 MiB;mysql 76 MiB 已随下线归零)
- [x] mysql 容器已停(清除归票 13)—— docker stop;镜像/卷/mysql_data 留存待票 13

实施注记:
- 镜像策略:backend 复用票 11 load 的 chrome-tab-backend:latest(此后 Node 源零改动,与 HEAD 等价);仅重建 caddy 带 ADR-0017 前端配套(前端配套与 Java 先行实现已切档前归档提交 0e95d9b,构建基线干净)。
- weather 切换前一直 500 的根因:服务器 compose backend 段从未透传 QWEATHER_*(.env 有键、compose 无 ${} 引用行)——「追加式维护 .env」的暗坑。新 compose 补上透传,切换后 weather 首次真正工作(smoke bundle=ok)。deploy skill 教程值得同步此点(票 13)。
- caddy 无证书卷(既有形态):recreate 触发 ACME 重签,约 30s 内 TLS 拒连(SSL alert 80)后恢复——发布频繁有 Let's Encrypt 限额风险,票 13 评估加卷。
- changelog 启动预热 GitHub 超时(阿里云常态)→ 「沿用现有快照」降级按 ADR-0017 设计工作,端点 200 秒级可服务;6h cron 自动重试。
- 切换日交付物:backend/scripts/smoke.mjs(`pnpm smoke`,凭据缺省 ssh tab 读 .env、不打印)+ 仓库 docker-compose.prod.yml 改写为无 mysql 的 Node 形态 + 服务器 compose 留档 docker-compose.java-mysql.bak。
