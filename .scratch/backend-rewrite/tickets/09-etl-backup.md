# 09 — ETL 脚本 + 每日 VACUUM INTO 备份

**What to build:** mysql2 → better-sqlite3 全量 ETL 脚本:1 MB 级数据秒级跑完,迁移 7 张数据表(users、pages、icons、layout_settings、config_version、changelog_snapshot、changelog_translations;sessions 为 Node 新增不迁)。只做全量重跑,不写任何增量同步代码(提前跑的属演练)。附对账报告作为数据迁移验证载体:行数逐表比对 + 关键字段抽查。备份:每日 `VACUUM INTO`(live 库安全;禁止直接 cp 库文件),复用既有 cron;恢复 = 拷回文件。

**Blocked by:** 03 — SQLite schema(表结构定型即可写,不依赖任何端点)。

**Status:** ready-for-agent

- [x] 对真实 MySQL 结构(含本机 Java 库)跑 ETL 秒级完成,对账报告 7 张表零差异 —— 2026-08-22 演练:mysql:8 容器压平执行 V1~V11 + 真实 bcrypt 数据,`pnpm etl` 0.2s 零差异(含 500KB snapshot)
- [x] bcrypt 哈希、json 串、时间戳字符串逐字节原样拷贝 —— bcryptjs compareSync 对迁移产物 10/12 rounds 双用户验证通过;对账全行逐字段 === 比对
- [x] 全量重跑幂等(覆盖旧 SQLite 数据无残留)—— 单测 + 真实二跑零差异
- [x] `VACUUM INTO` 在 live 库上安全产出单文件,拷回后应用可正常服务 —— 备份→拷回→openDb 起应用→登录 200 + config 200(含备份前最后一笔写)
