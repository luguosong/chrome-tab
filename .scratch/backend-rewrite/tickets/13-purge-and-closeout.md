# 13 — 清除与收尾(Java/MySQL 彻底退场)

**What to build:** 切换成功确认后,同 session 收尾三件事。清除:服务器删 mysql 容器/镜像/卷 + compose mysql 段 + 旧 backend 镜像 + `.env` 清 `DB_*`(追加式维护原则下的反向操作);代码侧同 PR 删 Java(`backend/` 路径由 Node 沿用,不打 tag,git 历史即后路)。文档:CONTEXT.md 技术栈表述更新;可选落迁移 ADR。deploy skill:更新为 Node 形态,之后的发布流程不再走旧路。唯一保留物:票 12 的终版 mysqldump 存档。

**Blocked by:** 12 — 切换日。

**Status:** done(2026-08-23;服务器清除 + 证书卷落地 + 全库删 Java + 文档收尾)

- [x] 服务器无 mysql 容器/镜像/卷;`.env` 无 `DB_*` 残留 —— 容器/卷/mysql:8 镜像(回收 1.12GB)全删;`.env` 清 MYSQL_DATABASE + DB_USER/PASSWORD/ROOT_PASSWORD 四键,余 7 键全 Node 形态
- [x] compose 文件无 mysql 段,根 Dockerfile/caddy 零额外改动 —— 服务器/仓库 prod/node 三份 compose 均无 mysql 段;根 Dockerfile 零改动(Caddyfile 动了,见注记,属票 12 委托的证书卷评估项落地)
- [x] 代码库无 Java 源码与构建配置,workspace 仍全绿 —— 删 src/main(Flyway 11 个 V*.sql 随迁 git 历史)、src/test、pom.xml、Eclipse 工程文件、target/;.gitignore 与根 .dockerignore 清 Java 条目;backend 162 + frontend 197 + extension 4 测试全过,backend 镜像重构建通过
- [x] CONTEXT.md 技术栈表述为 Node + SQLite;(可选)迁移 ADR 落档 —— 简介段补技术栈一句;ADR-0019 落档(动机/迁移纪律/取舍/备选)
- [x] deploy skill 与切换日实际操作路径一致,发布流程走 Node 形态 —— 全文改写:backend 构建 context 改仓库根(-f backend/Dockerfile)、凭据同步走容器内 better-sqlite3(实测过)、smoke 为验证主路径、透传暗坑与证书卷入备忘
- [x] mysqldump 终版存档确认保留 —— 服务器 /opt/chrome-tab/mysql-final-20260822.sql.gz(188KB)+ 本地 ~/mysql-final-chrome-tab-20260822.sql.gz,gunzip -t 双份可读

实施注记:
- **证书卷 + 双 CA(票 12 注记的评估落地,过程踩坑)**:compose 三份补 `caddy_data` 卷;挂卷 recreate 恰好撞上 Let's Encrypt 5 张/周/exact-set 限额(切换日 + 历次发布已耗尽),第 6 张 429,全站 TLS 拒连数小时。修复:Caddyfile 改双 issuer——ZeroSSL ACME(绑定 email 1054595718@qq.com,用户确认)优先、LE 兜底,两 CA 限额池独立。中途一次 Caddyfile 语法错误(`issuer zerossl` 裸用不合法,须走 `issuer acme { dir https://acme.zerossl.com/v2/D90B }` + 全局 email 块)致 crash loop,已让「改 Caddyfile 必先本地 caddy validate」进 deploy skill。最终由旧容器后台重试在 LE 窗口滚动放行后签出正式证书写入卷;新容器启动零签发动作,证明卷持久化生效。
- 服务器另清:docker-compose.java-mysql.bak(「唯一保留物」原则)、etl-rehearsal/(票 11 演练产物,零差异证据在票 11 commit)、.env 清理前的临时备份。
- 代码侧保留:TS 里「照 Java 行为」类对照注释(契约测试语义依据)、`etl.cli.ts` + mysql2 devDep(mysqldump 存档的配套读取器,恢复链路要用)。
