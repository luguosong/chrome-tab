-- ADR-0001 / issue 03：删除旧领域表。
-- 前端已切换到 Icon 模型（issue 02 完成），聚合接口不再返回 navLinks/stockWatches，
-- 数据已在 V2 + IconModelMigration 阶段镜像进 pages/icons。旧表与端点彻底退役。
DROP TABLE IF EXISTS nav_links;
DROP TABLE IF EXISTS stock_watches;
