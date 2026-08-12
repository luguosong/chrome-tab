-- 布局设置(CONTEXT.md「布局设置」):每个用户一行的图标网格显示几何偏好。
-- 与 pages/icons 同按 user_id 隔离,ON DELETE CASCADE 随用户删除。
-- 跨设备共享:任意设备登录同一账号即读同一行;无行时 GET /api/config 回退默认值。
-- 不在此 INSERT 回填——默认值由 LayoutSettingResponse.defaults() 在读路径兜底。
CREATE TABLE layout_settings (
    user_id     BIGINT PRIMARY KEY,
    grid_width  INT NOT NULL,                              -- 网格最大宽度(px),640..1536,默认 1024
    grid_gap    INT NOT NULL,                              -- 格子间距 gap(px),0..24,默认 8
    icon_scale  DOUBLE NOT NULL,                           -- favicon 像素+内边距同比系数,0.75..1.5,默认 1.0
    updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_layout_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
