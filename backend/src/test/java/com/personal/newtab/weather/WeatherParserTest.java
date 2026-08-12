package com.personal.newtab.weather;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * {@link WeatherParser} 纯解析单测(见 ADR-0009)。不触网络/不启 Spring,用和风响应形状的
 * 合成 Map 断言归一化:实况(v7 字符串)、空气质量(v1 数值 + indexes/pollutants 数组)、
 * 预警(v1 alerts 数组 + zeroResult)、城市搜索(GeoAPI)。
 */
class WeatherParserTest {

    // ---------- 实况(v7 /v7/weather/now)----------

    @Test
    void parseNowMapsV7StringFields() {
        // now 字段 12 项,超出 Map.of 的 10 对上限,改用 ofEntries
        Map<String, Object> now = Map.ofEntries(
                Map.entry("obsTime", "2026-08-12T10:00+08:00"),
                Map.entry("temp", "25"),
                Map.entry("feelsLike", "27"),
                Map.entry("icon", "104"),
                Map.entry("text", "阴"),
                Map.entry("humidity", "65"),
                Map.entry("windDir", "南风"),
                Map.entry("windScale", "3"),
                Map.entry("windSpeed", "15"),
                Map.entry("pressure", "1010"),
                Map.entry("vis", "10"),
                Map.entry("precip", "0.0"));
        Map<String, Object> resp = Map.of("code", "200", "now", now);
        WeatherBundle.Now n = WeatherParser.parseNow(resp);
        assertThat(n.temp()).isEqualTo(25);
        assertThat(n.feelsLike()).isEqualTo(27);
        assertThat(n.humidity()).isEqualTo(65);
        assertThat(n.pressure()).isEqualTo(1010);
        assertThat(n.vis()).isEqualTo(10);
        assertThat(n.precip()).isEqualTo(0.0);
        assertThat(n.icon()).isEqualTo("104");
        assertThat(n.text()).isEqualTo("阴");
    }

    @Test
    void parseNowRejectsNon200() {
        Map<String, Object> resp = Map.of("code", "404");
        assertThatThrownBy(() -> WeatherParser.parseNow(resp))
                .isInstanceOf(IllegalStateException.class);
    }

    // ---------- 空气质量(v1 /airquality/v1/current)----------

    @Test
    void parseAirPicksQaqiAndMapsPollutants() {
        Map<String, Object> resp = Map.of(
                "indexes", List.of(
                        Map.of("code", "us-epa", "aqi", 50, "category", "Good",
                                "primaryPollutant", Map.of("code", "pm2p5", "name", "PM2.5")),
                        Map.of("code", "qaqi", "aqi", 42, "category", "优",
                                "primaryPollutant", Map.of("code", "pm2p5"))),
                "pollutants", List.of(
                        Map.of("code", "pm2p5", "concentration", Map.of("value", 12.3, "unit", "μg/m3")),
                        Map.of("code", "pm10", "concentration", Map.of("value", 25.0)),
                        Map.of("code", "o3", "concentration", Map.of("value", 60))));
        WeatherBundle.Air air = WeatherParser.parseAir(resp);
        assertThat(air).isNotNull();
        assertThat(air.aqi()).isEqualTo(42);          // 取 qaqi,非首个 us-epa
        assertThat(air.category()).isEqualTo("优");
        assertThat(air.primary()).isEqualTo("pm2p5");
        assertThat(air.pm2p5()).isEqualTo(12.3);
        assertThat(air.pm10()).isEqualTo(25.0);
        assertThat(air.o3()).isEqualTo(60.0);
        assertThat(air.so2()).isNull();               // so2 未出现在 pollutants → null
    }

    @Test
    void parseAirFallsBackToFirstIndexWhenNoQaqi() {
        Map<String, Object> resp = Map.of(
                "indexes", List.of(Map.of("code", "us-epa", "aqi", 88, "category", "Moderate")),
                "pollutants", List.of());
        WeatherBundle.Air air = WeatherParser.parseAir(resp);
        assertThat(air).isNotNull();
        assertThat(air.aqi()).isEqualTo(88);
        assertThat(air.category()).isEqualTo("Moderate");
    }

    @Test
    void parseAirNoIndexesReturnsNull() {
        Map<String, Object> resp = Map.of("indexes", List.of(), "pollutants", List.of());
        assertThat(WeatherParser.parseAir(resp)).isNull();
    }

    // ---------- 预警(v1 /weatheralert/v1/current)----------

    @Test
    void parseAlertsMapsEachAlert() {
        Map<String, Object> resp = Map.of(
                "metadata", Map.of("zeroResult", false),
                "alerts", List.of(Map.of(
                        "id", "alert1", "senderName", "市气象台", "severity", "Moderate",
                        "eventType", Map.of("name", "暴雨", "code", "rain"),
                        "headline", "暴雨黄色预警", "description", "注意防范",
                        "effectiveTime", "2026-08-12T10:00+08:00", "expireTime", "2026-08-12T20:00+08:00",
                        "color", Map.of("red", 255, "green", 200, "blue", 0, "alpha", 1))));
        List<WeatherBundle.Alert> alerts = WeatherParser.parseAlerts(resp);
        assertThat(alerts).hasSize(1);
        WeatherBundle.Alert a = alerts.get(0);
        assertThat(a.headline()).isEqualTo("暴雨黄色预警");
        assertThat(a.eventType()).isEqualTo("暴雨");
        assertThat(a.severity()).isEqualTo("Moderate");
        assertThat(a.color()).isNotNull();
        assertThat(a.color().red()).isEqualTo(255);
        assertThat(a.color().green()).isEqualTo(200);
    }

    @Test
    void parseAlertsZeroResultReturnsEmpty() {
        Map<String, Object> resp = Map.of("metadata", Map.of("zeroResult", true), "alerts", List.of());
        assertThat(WeatherParser.parseAlerts(resp)).isEmpty();
    }

    // ---------- 城市搜索(GeoAPI /geo/v2/city/lookup)----------

    @Test
    void parseLocationsMapsCandidatesWithCoords() {
        Map<String, Object> resp = Map.of(
                "code", "200",
                "location", List.of(
                        Map.of("name", "朝阳", "adm1", "北京市", "adm2", "朝阳区", "lat", "39.92", "lon", "116.45"),
                        Map.of("name", "朝阳", "adm1", "辽宁省", "adm2", "朝阳市", "lat", "41.57", "lon", "120.45")));
        List<LocationCandidate> out = WeatherParser.parseLocations(resp);
        assertThat(out).hasSize(2);
        assertThat(out.get(0).name()).isEqualTo("朝阳");
        assertThat(out.get(0).adm1()).isEqualTo("北京市");
        assertThat(out.get(0).lat()).isEqualTo(39.92);
        assertThat(out.get(1).adm1()).isEqualTo("辽宁省");   // 同名靠 adm1 消歧
    }

    @Test
    void parseLocationsNon200ReturnsEmpty() {
        Map<String, Object> resp = Map.of("code", "404");
        assertThat(WeatherParser.parseLocations(resp)).isEmpty();
    }
}
