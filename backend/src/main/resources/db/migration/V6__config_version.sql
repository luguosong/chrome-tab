-- 整体配置版本(ADR-0006 双端镜像 + 整体-blob LWW):每用户一行。
-- 任何配置写(icon / page / layout / PUT /api/config 全量替换)都在写事务内 bump updated_at。
-- 前端镜像据此与服务端比时间戳,新者整份赢——双向恢复(换浏览器拉服务端、服务端丢失从本地推)的判据。
-- 刻意不用 ON UPDATE CURRENT_TIMESTAMP:由代码显式赋值,保证与写事务原子、跨端可比、确定。
CREATE TABLE config_version (
    user_id     BIGINT PRIMARY KEY,
    updated_at  DATETIME NOT NULL,
    CONSTRAINT fk_cv_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
