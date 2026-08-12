package com.personal.newtab.layoutsetting;

/** 布局设置出参(聚合接口 expand + PUT 回执)。defaults()=无行时的兜底默认值。 */
public record LayoutSettingResponse(Integer gridWidth, Integer gridGap, Double iconScale) {

    public static LayoutSettingResponse of(LayoutSetting s) {
        return new LayoutSettingResponse(s.getGridWidth(), s.getGridGap(), s.getIconScale());
    }

    public static LayoutSettingResponse defaults() {
        return new LayoutSettingResponse(
                LayoutLimits.WIDTH_DEFAULT, LayoutLimits.GAP_DEFAULT, LayoutLimits.SCALE_DEFAULT);
    }
}
