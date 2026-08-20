-- 布局设置扩展(CONTEXT.md「布局设置」五组):网格竖向间距、背景雾化、
-- 搜索栏(宽度/显隐/引擎)、时钟(显隐/字号/时制)、图标名称(显隐/字号/颜色)。
-- 默认值 = 扩展前硬编码值(暗色页板 0.36、max-w-xl、text-5xl、text-xs),存量用户升级零视觉变化。
-- 旧客户端只写三字段(grid_width/grid_gap/icon_scale)的 PUT 仍被接受,其余列在此默认值兜底。
ALTER TABLE layout_settings
    ADD COLUMN grid_gap_y         INT        NOT NULL DEFAULT 8,          -- 竖向间距(px),0..32
    ADD COLUMN panel_fog          INT        NOT NULL DEFAULT 36,         -- 页板雾化浓度(%),0..60
    ADD COLUMN search_bar_width   INT        NOT NULL DEFAULT 576,        -- 搜索栏最大宽度(px),320..1024
    ADD COLUMN search_bar_visible BOOLEAN    NOT NULL DEFAULT TRUE,
    ADD COLUMN search_engine      VARCHAR(16) NOT NULL DEFAULT 'google',  -- google|bing|baidu
    ADD COLUMN clock_visible      BOOLEAN    NOT NULL DEFAULT TRUE,
    ADD COLUMN clock_font         INT        NOT NULL DEFAULT 48,         -- 时钟字号(px),28..72
    ADD COLUMN clock_24h          BOOLEAN    NOT NULL DEFAULT TRUE,
    ADD COLUMN label_visible      BOOLEAN    NOT NULL DEFAULT TRUE,
    ADD COLUMN label_size         INT        NOT NULL DEFAULT 12,         -- 图标名称字号(px),10..16
    ADD COLUMN label_color        CHAR(7)    NOT NULL DEFAULT '#ffffff';
