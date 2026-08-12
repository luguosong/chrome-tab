-- 只保留深色主题：settings 表仅存 theme 字段，前端改为永久深色后该表无用途，删除整表。
-- settings 仅被 users 以 ON DELETE CASCADE 引用，无其它表反向引用，可安全 drop。
DROP TABLE IF EXISTS settings;
