-- ADR-0017 更新日志副本持久化:译文按版本块哈希增量积累,原文快照单行存档。
-- 译文表:主键 = 版本块原文 SHA-256(hex 64 位)——一版一行、永久保留,每版终身只译一次;
--   定时预取(最近 N 版)与前端按需补译(旧版)共用此表,重启零重译。
CREATE TABLE changelog_translations (
    block_hash CHAR(64) PRIMARY KEY,
    translated TEXT NOT NULL,                                 -- 单版本块译文(实测 ≤ 数 KB)
    created_at DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 快照表:单行(id 恒 1),原文全文 + npm 最新版发布日期 + 拉取时间。
-- 原文是唯一事实源,译文按块哈希覆盖其上拼装;请求路径纯读快照(内存镜像),零外呼。
-- 列型对齐 JPA 实体(生产 ddl-auto=validate):id INT ↔ Integer,block_hash CHAR(64) 见译文表。
CREATE TABLE changelog_snapshot (
    id INT PRIMARY KEY,
    raw_markdown LONGTEXT NOT NULL,                           -- 原文全文(实测 498KB,超 TEXT 64KB 上限)
    released_at VARCHAR(64) NULL,                             -- ISO 串;npm 拉取失败为 NULL
    fetched_at DATETIME NOT NULL,
    CONSTRAINT chk_changelog_snapshot_single CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
