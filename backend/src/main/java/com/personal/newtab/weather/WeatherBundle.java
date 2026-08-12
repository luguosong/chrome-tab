package com.personal.newtab.weather;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.util.List;

/**
 * 一个位置三合一的天气数据(见 ADR-0009),后端归一化和风原始数组形态后下发给前端。
 * 前端不感知和风 indexes[]/pollutants[]/alerts[] 的嵌套与多标准选择。
 *
 * <p>{@code now} 必填(取数失败时整个 bundle 为 null,而非半截);{@code air} 可空(无 AQI 标准);
 * {@code alerts} 无预警时为空数组。</p>
 */
@JsonInclude(JsonInclude.Include.NON_NULL)   // air 为 null 时不输出该字段
public record WeatherBundle(
        String location,
        Now now,
        Air air,
        List<Alert> alerts
) {
    /** 实况(和风 /v7/weather/now)。 */
    public record Now(
            String obsTime, int temp, int feelsLike, String icon, String text,
            int humidity, String windDir, String windScale, String windSpeed,
            int pressure, int vis, double precip) {}

    /** 空气质量(和风 v1 /airquality/v1/current,取通用 AQI qaqi 为准)。null = 该位置无 AQI 数据。 */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Air(
            int aqi, String category, String primary,
            Double pm2p5, Double pm10, Double no2, Double so2, Double co, Double o3) {}

    /** 灾害预警单条(和风 v1 /weatheralert/v1/current)。v1 字段:headline(标题)/severity/color/eventType.name。 */
    public record Alert(
            String id, String senderName, String severity, String eventType,
            String headline, String description,
            String effectiveTime, String expireTime, String icon,
            AlertColor color) {}

    /** 预警等级色(rgb;alpha 省略,UI 用固定不透明度叠加)。 */
    public record AlertColor(int red, int green, int blue) {}
}
