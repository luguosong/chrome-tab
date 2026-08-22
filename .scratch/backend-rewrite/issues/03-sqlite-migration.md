# 03 SQLite 适配与数据迁移面

Type: research
Status: resolved

## Question

MySQL → SQLite 的适配与数据迁移面:现有 11 个 Flyway 迁移(`backend/src/main/resources/db/migration/`)的 schema 映射到 SQLite 方言的差异点(json 列 → TEXT、datetime、自增/rowid、外键、唯一索引);better-sqlite3 的 WAL 并发写对个人项目(用户量个位数)的适用性;线上 mysqldump → SQLite 的具体导入路径;备份策略变化(单文件复制 vs mysqldump);以及「全迁 Node 与换库同时做」的风险评估。产出可行性结论 + 方言差异清单 + 数据迁移路径。

## Answer

**可行,零硬阻塞。** 7 张表最终 schema 无任何 MySQL 专有能力被真正依赖(icons.data 本就是 TEXT 存 JSON、时间戳全由代码赋值、唯一 `ON UPDATE` 落在无人读的 `layout_settings.updated_at`),全部方言差异点已实验验证并附 SQLite 建表脚本骨架。better-sqlite3 单进程单连接同步 API 无进程内写竞争,WAL 对个位数用户低频写完全适用(注意:库文件不能在 NFS,连接须显式 `foreign_keys = ON`)。数据迁移推荐一次性 Node ETL 脚本(mysql2 读 → better-sqlite3 写,全库 1MB 级秒级完成),时间戳原样字符串拷贝、Node 容器保持 UTC 以保 LWW 排序;备份改每日 `VACUUM INTO`(live 库安全,禁止直接 cp),恢复 = 拷回文件。风险面:不建议「Node+MySQL 先行」两步走(DB 层写两遍、两次切换),改用「数据先行迁入 SQLite 对账、切换日只剩换容器」解耦;最大风险点不在换库而在业务重写本身,契约测试(ticket 05)才是解药。

→ Findings 全文:[../research/03-sqlite-migration.md](../research/03-sqlite-migration.md)
