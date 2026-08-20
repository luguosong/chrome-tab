-- ADR-0011：分组 = icons 行 + parent_id 自引用。
-- FK 用 RESTRICT（有意偏离项目惯用 CASCADE）：删组行前必须先解散，DB 层防「误删组连带吞子图标」。
-- 纯加列，无数据迁移。注意 PUT /api/config 的全量清空必须先删 parent_id 非空行（见 ConfigReplaceService）。
ALTER TABLE icons ADD COLUMN parent_id BIGINT NULL;
ALTER TABLE icons ADD CONSTRAINT fk_icon_parent FOREIGN KEY (parent_id) REFERENCES icons(id) ON DELETE RESTRICT;
CREATE INDEX idx_icon_parent ON icons (parent_id);
