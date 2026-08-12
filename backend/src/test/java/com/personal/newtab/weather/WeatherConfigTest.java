package com.personal.newtab.weather;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * {@link WeatherConfig#baseUrlFor(String)} 纯逻辑测试(参照 {@code ChangelogConfigTest} 的静态辅助测试范式)。
 *
 * <p>历史 bug:application.yml 的 {@code api-host} 默认值曾是无 scheme 裸主机,JDK HttpClient 在请求
 * 构建期抛 "URI with undefined scheme"。本测试锁死「裸主机一律补 https://」这一不变量。</p>
 */
class WeatherConfigTest {

    @Test
    void blankFallsBackToPlaceholder() {
        assertThat(WeatherConfig.baseUrlFor(null)).isEqualTo("https://devapi.qweatherapi.com");
        assertThat(WeatherConfig.baseUrlFor("")).isEqualTo("https://devapi.qweatherapi.com");
        assertThat(WeatherConfig.baseUrlFor("   ")).isEqualTo("https://devapi.qweatherapi.com");
    }

    @Test
    void schemelessHostGetsHttpsPrefix() {
        // 历史默认值正是裸主机——必须补 scheme,否则 "URI with undefined scheme"
        assertThat(WeatherConfig.baseUrlFor("p75n8gyjky.re.qweatherapi.com"))
                .isEqualTo("https://p75n8gyjky.re.qweatherapi.com");
    }

    @Test
    void hostWithSchemeIsUnchanged() {
        assertThat(WeatherConfig.baseUrlFor("https://abc.qweatherapi.com"))
                .isEqualTo("https://abc.qweatherapi.com");
        assertThat(WeatherConfig.baseUrlFor("http://localhost:8080"))
                .isEqualTo("http://localhost:8080");
    }
}
