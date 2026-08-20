package com.personal.newtab.layoutsetting;

/** 布局设置出参(聚合接口 expand + PUT 回执)。defaults()=无行时的兜底默认值。 */
public record LayoutSettingResponse(
        Integer gridWidth, Integer gridGap, Integer gridGapY, Double iconScale,
        Integer panelFog,
        Integer searchBarWidth, Boolean searchBarVisible, String searchEngine,
        Boolean clockVisible, Integer clockFont, Boolean clock24h,
        Boolean labelVisible, Integer labelSize, String labelColor) {

    public static LayoutSettingResponse of(LayoutSetting s) {
        return new LayoutSettingResponse(s.getGridWidth(), s.getGridGap(), s.getGridGapY(),
                s.getIconScale(), s.getPanelFog(),
                s.getSearchBarWidth(), s.getSearchBarVisible(), s.getSearchEngine(),
                s.getClockVisible(), s.getClockFont(), s.getClock24h(),
                s.getLabelVisible(), s.getLabelSize(), s.getLabelColor());
    }

    public static LayoutSettingResponse defaults() {
        return new LayoutSettingResponse(
                LayoutLimits.WIDTH_DEFAULT, LayoutLimits.GAP_DEFAULT, LayoutLimits.GAP_Y_DEFAULT,
                LayoutLimits.SCALE_DEFAULT, LayoutLimits.FOG_DEFAULT,
                LayoutLimits.SEARCH_WIDTH_DEFAULT, true, LayoutLimits.ENGINE_DEFAULT,
                true, LayoutLimits.CLOCK_FONT_DEFAULT, true,
                true, LayoutLimits.LABEL_SIZE_DEFAULT, LayoutLimits.LABEL_COLOR_DEFAULT);
    }
}
