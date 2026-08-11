package com.personal.newtab.setting;

public record SettingResponse(String theme) {
    public static SettingResponse of(Setting s) {
        return new SettingResponse(s.getTheme());
    }
}
