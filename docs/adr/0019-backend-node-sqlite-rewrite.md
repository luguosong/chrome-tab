# 后端重写:Hono + SQLite 替换 Spring Boot + MySQL

2026-08 立项、2026-08-22 切换日落地:后端从 Spring Boot 3.4 + MySQL 8(Flyway、JPA)整栈替换为 Hono + better-sqlite3(WAL,Kysely 查询构建),同仓 pnpm workspace 包(`backend/`,ADR-0018)。行为契约经 Java 侧测试语义移植(契约测试即迁移规范),数据经全量 ETL 对账零差异后 big bang 切换(停机约 40 秒),Java 源码与 mysql 容器/卷随即清除,唯一保留物为终版 mysqldump 双份存档(服务器 + 本地,恢复 = 起 MySQL 导入 → 重跑 ETL,工具链 `etl.cli.ts` 在库)。

**动机**:私人单用户项目,Java + MySQL 的常驻成本与仪式感不成比例——JVM 基线内存、mysql 容器 76 MiB、每次 schema 变更走 Flyway 迁移文件与镜像重建。SQLite 单文件(WAL)把「数据库」降维成「文件」:备份 = `VACUUM INTO` 出一个拷贝(每日 cron,票 09),恢复 = 拷回;Node 后端强制 GC 后实测 RSS 32.5 MiB。代理功能(weather/wallpaper/changelog LLM)本就无状态查询,关系型能力需求止步于 8 张平表。

**迁移纪律(失败向前,无回滚)**:契约先行——Node 契约测试语义源逐条对齐 Java 测试与线上实际行为(含 Java 侧 bug 的「照抄 vs 修正」白名单,如 wallpaper 缓存失效、move 排序空洞);ETL(7 表)演练两轮零差异(票 11)后才排切换日;切换日单 session 清单化:stop → 终版 mysqldump → ETL → 新 compose up → 9/9 smoke。sessions 载体更换致登录态失效一次,属预期。bcrypt 哈希原样迁移,账密零重置。

**已知取舍**:changelog GitHub 预热在服务器网络环境常超时,降级「沿用现有快照」按 ADR-0017 设计工作(端点秒级可服务);caddy 证书已补挂 `caddy_data` 卷(recreate 不再重签)并配双 CA——ZeroSSL ACME 优先、Let's Encrypt 兜底(2026-08-22 曾因无卷 + LE 5 张/周限额全站 TLS 拒连半日,双 CA 限额池独立后同类事故不再可能)。

## 备选方案(已否决)

- **Next.js 全栈**:2026-08-21 评估否决(ADR-0018 首段),Caddy 必留做 TLS、运行时更重、SPA 无 SSR 价值。
- **逐端点灰度切换**:单用户项目无灰度受众;契约测试 + ETL 对账 + smoke 的验证强度下,big bang 一步到位更省且停机仅几十秒。
- **保留 Java 栈不动**:运维成本(内存、双容器、迁移仪式)持续发生;重写一次性成本已被契约测试复用摊薄(测试即规范,长期资产)。
