package com.personal.newtab.layoutsetting;

/**
 * 布局设置数值边界与默认值(前端镜像同范围:lib/layoutSettings.ts)。
 * 默认值=改造前硬编码:max-w-5xl(1024px)、gap-2(8px)、scale 1.0。
 */
public final class LayoutLimits {
    public static final int WIDTH_MIN = 640;
    public static final int WIDTH_MAX = 1536;
    public static final int WIDTH_DEFAULT = 1024;

    public static final int GAP_MIN = 0;
    public static final int GAP_MAX = 24;
    public static final int GAP_DEFAULT = 8;

    /** @DecimalMin/@DecimalMax 取 String,需编译期常量字面量。 */
    public static final String SCALE_MIN = "0.75";
    public static final String SCALE_MAX = "1.5";
    public static final double SCALE_DEFAULT = 1.0;

    private LayoutLimits() {}
}
