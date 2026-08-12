package com.personal.newtab.weather;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 天气取数配置(newtab.weather.*,见 ADR-0009)。
 *
 * <p>Key 与个人专用主机均走环境变量注入、不入库;任一为空则 {@link WeatherService} 抛"未配置",
 * 经 GlobalExceptionHandler → 500,前端天气图标显示"刷新失败/重试"(与自选股降级一致)。</p>
 */
@Getter
@Setter
@ConfigurationProperties("newtab.weather")
public class WeatherProperties {

    /** 和风 API Key,经 QWEATHER_API_KEY 注入。留空 → 未配置。 */
    private String apiKey = "";

    /** 个人专用主机,如 https://abcxyz.qweatherapi.com。旧共享主机(devapi/api/geoapi)2026 起逐步停用。 */
    private String apiHost = "";

    /** 响应语言,默认简体中文。 */
    private String lang = "zh-hans";
}
