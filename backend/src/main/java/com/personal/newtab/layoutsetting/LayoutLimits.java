package com.personal.newtab.layoutsetting;

/**
 * 布局设置数值边界与默认值,前端镜像同范围:lib/layoutSettings.ts)。
 * 默认值=改造前硬编码:max-w-5xl(1024px)、gap-2(8px)、scale 1.0、
 * 暗色页板 0.36、搜索框 max-w-xl(576px)、时钟 text-5xl(48px)、名称 text-xs(12px)。
 * 扩展字段(gridGapY 起)在请求侧可空:旧客户端只写三字段时,null 落 DEFAULT。
 */
public final class LayoutLimits {
    public static final int WIDTH_MIN = 640;
    public static final int WIDTH_MAX = 1536;
    public static final int WIDTH_DEFAULT = 1024;

    public static final int GAP_MIN = 0;
    public static final int GAP_MAX = 24;
    public static final int GAP_DEFAULT = 8;

    /** 竖向间距上限比横向宽:固定画布不滚动,行距过大网格会溢出视口。 */
    public static final int GAP_Y_MIN = 0;
    public static final int GAP_Y_MAX = 32;
    public static final int GAP_Y_DEFAULT = 8;

    /** @DecimalMin/@DecimalMax 取 String,需编译期常量字面量。
     *  ADR-0016:默认 1.5(整体放大)、上限 2.0——iconScale 是图标整体大小的唯一调节。 */
    public static final String SCALE_MIN = "0.75";
    public static final String SCALE_MAX = "2.0";
    public static final double SCALE_DEFAULT = 1.5;

    public static final int FOG_MIN = 0;
    public static final int FOG_MAX = 60;
    public static final int FOG_DEFAULT = 36;

    public static final int SEARCH_WIDTH_MIN = 320;
    public static final int SEARCH_WIDTH_MAX = 1024;
    public static final int SEARCH_WIDTH_DEFAULT = 576;

    public static final int CLOCK_FONT_MIN = 28;
    public static final int CLOCK_FONT_MAX = 72;
    public static final int CLOCK_FONT_DEFAULT = 48;

    public static final int LABEL_SIZE_MIN = 10;
    public static final int LABEL_SIZE_MAX = 16;
    public static final int LABEL_SIZE_DEFAULT = 12;

    public static final String LABEL_COLOR_DEFAULT = "#ffffff";
    public static final String ENGINE_DEFAULT = "google";

    private LayoutLimits() {}
}
