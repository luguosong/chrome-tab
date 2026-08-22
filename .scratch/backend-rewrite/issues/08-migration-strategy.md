# 08 迁移执行策略

Type: grilling
Status: resolved
Blocked by: 03, 05

## Question

迁移执行策略:big bang 一次切换 vs 按模块渐进落地(用户口径「彻底改造」偏向前者,但需在契约清单与 SQLite 结论到位后正式定);部署流程变化(compose 去 MySQL 服务、镜像变化、deploy skill 更新);数据迁移窗口与回滚预案(MySQL 数据与容器保留多久作后路);测试对齐策略。产出执行顺序清单,让后续执行 session 可直接照做。

## Answer

**2026-08-21 定版(用户逐项批准;测试对齐已单列为票 09)**:

1. **切换形态:big bang。** feature branch 全量重写,期间 Java(master)冻结非紧急改动(紧急 bug 在 master 修 Java 照旧发布,branch rebase 跟进);部署无并存期,一次切换。
2. **无回滚后路,切换成功即彻底清除**(用户原话口径:个人自用系统,删除零负担,代码和服务器全部清除干净):
   - 服务器:mysql 容器 + mysql:8 镜像 + `mysql_data` 卷 + compose mysql 段、旧 Java backend 镜像;
   - 代码:`backend/` Java 目录随切换 PR 删除(不打 tag,git 历史即后路),新 Node 代码沿用 `backend/` 路径(compose build context 零改动);服务器 `.env` 清 `DB_*` 变量。
   - 失败处理 = **向前修复**:验证全部前置——契约测试(票 09)+ ETL 演练对账是切换的硬前提。
3. **唯一数据安全网**:清毁 `mysql_data` 卷**之前**留一份终版 `mysqldump` 纯文件存档(几 MB,服务器普通目录或拉回本地)。数据(users/pages/icons)是唯一不可再生物,代码可由 git 恢复;此为「全部清除」计划中唯一保留物。
4. **切换日数据流程(修正票 03「数据先行」的窗口漏洞——先行迁好的 SQLite 会在切换前被旧后端继续写入甩陈旧)**:提前跑的 ETL 属**演练**(验证脚本 + 对账);切换日正式流程 = 停旧 backend → 终版 mysqldump 存档 → **重跑一次全量 ETL**(1 MB 级,秒级)→ 起新容器。**不写任何增量同步代码**——全量重跑秒级,停机几分钟个人项目无感。
5. **deploy skill 切换日同 session 更新**:backend 构建分支改 Node 镜像、删 mysql 相关表述、步骤 5 凭据同步改写为 SQLite 形式、compose 注释同步。
6. **caddy 镜像/容器零改动**(事实确认:根 Dockerfile 两阶段——node 构建前端 → caddy 托管 dist + 反代 `/api`,后端整棵替换对 caddy 不可见)。注意 pnpm workspace 化后需验证 caddy 镜像的构建路径(COPY 路径/workspace 文件位置)不破。
7. **无切换窗口**:任选空闲时段,停机预期几分钟,「窗口」不进决策包。

### 执行顺序清单(后续执行 session 直接照做)

**阶段 A 重写(feature branch,每步可独立验证)**
- A1 pnpm workspace 化:根 workspace(frontend + shared + backend),`shared/` 纯 TS 类型双端直引;验证根 Dockerfile 前端构建路径不破
- A2 `backend/` Node 骨架:Hono + better-sqlite3(WAL、`foreign_keys = ON`、容器 TZ=UTC 保 LWW)+ Kysely + 新 Dockerfile
- A3 SQLite schema(7 表,以票 03 findings 的建表脚本为底)
- A4 auth 三端点 + sessions 表(TTL 30d)+ 空库 seed(照票 04 冻结语义;jose + bcryptjs)
- A5 pages/icons/layout CRUD + config aggregate(LWW/config_version 镜像;实现 api-contract.md 修正白名单的 7 项语义)
- A6 changelog:快照表 + 翻译持久化(ADR-0017 语义;node-cron 6h 定时)
- A7 weather/wallpaper/stock 透传与缓存端点
- A8 AI 骨架 B 档:tool registry + agent loop(~170 行)+ 单测,MCP 仅 interface(照 ai-platform.md;不装包)
- A9 ETL 脚本(mysql2 → better-sqlite3,含对账报告)+ 每日 `VACUUM INTO` 备份(node-cron,容器内)

**阶段 B 测试(票 09 定策略;切换硬前置)**
- B1 契约测试以 api-contract.md 为基准逐端点断言

**阶段 C 切换日(一 session 完成)**
- C1(提前数日)服务器 ETL 演练 + 对账
- C2 切换:停旧 backend → 终版 mysqldump 存档 → 重跑全量 ETL → 新 compose(无 mysql)up → 冒烟(登录链路 + 关键端点)
- C3 清除:服务器删 mysql 容器/镜像/卷 + 旧 backend 镜像;同 PR 删 Java 代码 + `.env` 清 `DB_*`;CONTEXT.md 技术栈表述顺手更新;(可选)落迁移 ADR
- C4 deploy skill 更新(见第 5 条)

**阶段 D 切换后(非阻塞、另立项)**
- D1 滴答清单图标(纯传统,直调滴答 API,规格见票 06)

**下游影响**:票 09(测试对齐)解锁,成为 frontier 唯一票;map fog「上线切换窗口与回滚预案细化」随本票清除(结论:无窗口、无回滚)。
