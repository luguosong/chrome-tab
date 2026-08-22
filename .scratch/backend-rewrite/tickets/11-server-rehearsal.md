# 11 — 服务器 ETL 演练(提前数日)

**What to build:** 切换日前数日在服务器(`ssh tab`)上用真实线上 MySQL 数据跑一次 ETL 演练:全量拉到临时 SQLite 文件,对账报告零差异。演练只读线上 MySQL,不碰正在运行的 Java/MySQL 容器;产物留存作切换日参照。目的:把切换日的未知数(网络、权限、数据规模、字符集)提前清零。

**Blocked by:** 09 — ETL 脚本;10 — 契约测试收口。

**Status:** done(2026-08-22,报告留档 rehearsal-report.txt;产物在服务器 /opt/chrome-tab/etl-rehearsal/)

- [x] 服务器上 ETL 演练完成,对账报告零差异
- [x] 线上 Java + MySQL 运行不受任何影响(演练全程只读)
- [x] 临时 SQLite 产物与对账报告留存,切换日直接对照

实施注记:服务器无 node,演练载体 = 新 backend 镜像(chrome-tab-backend:latest,含新增 dist/etl.cjs)
一次性容器跑 ETL——与切换日环境同构(musl 编译的 better-sqlite3 + 容器网络)。
本地先行端到端(mysql:8 灌 Flyway V1–V11 + 中文种子)后才上服务器。
