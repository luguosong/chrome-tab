-- 修正 V8 笔误:label_color 写成了 CHAR(7),实体 @Column(length=7) 映射 varchar(7),
-- ddl-auto=validate 启动即拒(found CHAR, expecting VARCHAR)。对齐数据库到实体。
ALTER TABLE layout_settings
    MODIFY COLUMN label_color VARCHAR(7) NOT NULL DEFAULT '#ffffff';
