-- ADR-0016 图标单档化:删除尺寸概念(所有图标恒占 1 格)。
-- 1) icons.size 列整个移除——存量 medium/large 图标随列删除自然并入单档,
--    容量方向安全(原 large 占 6 格,现一律 1 格,只释放格子、无溢出风险)。
ALTER TABLE icons DROP COLUMN size;

-- 2) iconScale 默认整体放大 1.0 → 1.5(用户要求默认放大方便读信息)。
--    只提升从未动过该滑块的行(icon_scale = 1.0 = 旧默认);用户手动调过的值尊重不动。
UPDATE layout_settings SET icon_scale = 1.5 WHERE icon_scale = 1.0;
