# 13 — 清除与收尾(Java/MySQL 彻底退场)

**What to build:** 切换成功确认后,同 session 收尾三件事。清除:服务器删 mysql 容器/镜像/卷 + compose mysql 段 + 旧 backend 镜像 + `.env` 清 `DB_*`(追加式维护原则下的反向操作);代码侧同 PR 删 Java(`backend/` 路径由 Node 沿用,不打 tag,git 历史即后路)。文档:CONTEXT.md 技术栈表述更新;可选落迁移 ADR。deploy skill:更新为 Node 形态,之后的发布流程不再走旧路。唯一保留物:票 12 的终版 mysqldump 存档。

**Blocked by:** 12 — 切换日。

**Status:** ready-for-agent

- [ ] 服务器无 mysql 容器/镜像/卷;`.env` 无 `DB_*` 残留
- [ ] compose 文件无 mysql 段,根 Dockerfile/caddy 零额外改动
- [ ] 代码库无 Java 源码与构建配置,workspace 仍全绿
- [ ] CONTEXT.md 技术栈表述为 Node + SQLite;(可选)迁移 ADR 落档
- [ ] deploy skill 与切换日实际操作路径一致,发布流程走 Node 形态
- [ ] mysqldump 终版存档确认保留
