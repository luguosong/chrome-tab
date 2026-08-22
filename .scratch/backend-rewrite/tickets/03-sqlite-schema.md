# 03 — SQLite schema 全量落库(8 张表)

**What to build:** 以 research/03 的建表脚本骨架为底,在 SQLite 落全 8 张表:现有 7 张(users、pages、icons、layout_settings、config_version、changelog_snapshot、changelog_translations)平移 + Node 新增 sessions。方言要点照 spec:json 列 TEXT 存 JSON、时间戳全由代码赋值字符串原样拷贝、连接显式 `foreign_keys = ON`、容器保持 UTC(保 config_version LWW 排序语义)。这是后续所有功能票共用的地基(prefactor)。

**Blocked by:** 02 — Node 后端骨架。

**Status:** done

- [x] 8 张表结构与 research/03 骨架一致,结构断言测试通过
- [x] 外键约束实际生效(删除被引用行被数据库拒绝)
- [x] 建表在空库可重复执行不报错
- [x] 容器内时区为 UTC

## Comments

- 2026-08-22 实现完成。`backend/src/schema.ts` = DDL(`CREATE TABLE IF NOT EXISTS`,research/03 骨架逐字 + sessions)+ Kysely 8 表类型;`openDb` 收紧 `Kysely<any>` → `Kysely<SchemaDatabase>` 并接入 `migrate()`。`schema.test.ts` 16 断言:PRAGMA table_info 逐列快照、索引 4 个、FK CASCADE/RESTRICT 实测、TEXT 主键 NOT NULL、CHECK(id=1)、migrate 幂等。
- **已知边界如实钉住(research #7)**:icons 存在组内引用时 `DELETE FROM users` 被父引用 RESTRICT 拒——SQLite 级联删行顺序未定义;应用无删用户端点、写路径守「先删成员再删组」纪律,零影响。测试单列一项防回归误判。
- 容器 UTC 实测:宿主 +08:00 下 `docker run` 镜像内 `TZ=UTC`、IANA=UTC、offset 0(ENV 来自票 02 Dockerfile,本票验证非新增)。文件库实测:空库首启 8 表、重启幂等、双次 `/healthz` 200;esbuild bundle 605.9K 正常。
- code-review 双轴后修 4 处测试 cosmetic(「索引 5 个」名实不符系 research 笔误、实为 4 个;`ReturnType<typeof fresh>` 改直引 `Database` 类型;`tableCount()` 助手去重;`_table` 前缀)。sessions 补 `user_id FK CASCADE` 判定为合理补齐(与全库不变量一致)。
