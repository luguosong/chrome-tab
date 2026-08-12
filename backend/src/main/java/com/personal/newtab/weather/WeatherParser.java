package com.personal.newtab.weather;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * 和风响应 → 归一化 DTO 的纯解析(见 ADR-0009)。无 HTTP、无 Spring,可纯 JUnit 断言。
 *
 * <p>防御式读取兼容两种形态:和风 v7(/v7/weather/now、/geo/v2/city/lookup)字段多为字符串且带顶层 code;
 * v1(/airquality/v1/current、/weatheralert/v1/current)字段多为数值、无顶层 code、靠 HTTP 状态判成败。
 * 故数值读取同时接受字符串与数值。</p>
 */
public final class WeatherParser {

    private WeatherParser() {}

    /** 实况:code != 200 或缺 now 抛异常(调用方据此判该位置取数失败)。 */
    public static WeatherBundle.Now parseNow(Map<?, ?> resp) {
        if (!"200".equals(str(resp, "code"))) {
            throw new IllegalStateException("weather-now 响应非 200");
        }
        Map<?, ?> n = map(resp, "now");
        if (n == null) throw new IllegalStateException("weather-now 缺 now");
        return new WeatherBundle.Now(
                str(n, "obsTime"), i(n, "temp"), i(n, "feelsLike"), str(n, "icon"), str(n, "text"),
                i(n, "humidity"), str(n, "windDir"), str(n, "windScale"), str(n, "windSpeed"),
                i(n, "pressure"), i(n, "vis"), d(n, "precip"));
    }

    /** 空气质量:选和风通用 AQI(qaqi),否则取首个 index;无任何 index 返回 null。 */
    public static WeatherBundle.Air parseAir(Map<?, ?> resp) {
        Map<?, ?> idx = pickIndex(list(resp, "indexes"));
        if (idx == null) return null;
        Map<?, ?> primary = map(idx, "primaryPollutant");
        List<?> polls = list(resp, "pollutants");
        return new WeatherBundle.Air(
                i(idx, "aqi"), str(idx, "category"),
                primary != null ? str(primary, "code") : null,
                pollutant(polls, "pm2p5"), pollutant(polls, "pm10"), pollutant(polls, "no2"),
                pollutant(polls, "so2"), pollutant(polls, "co"), pollutant(polls, "o3"));
    }

    /** 预警:metadata.zeroResult=true 或 alerts 空时返回空列表(无预警,非失败)。 */
    public static List<WeatherBundle.Alert> parseAlerts(Map<?, ?> resp) {
        Map<?, ?> meta = map(resp, "metadata");
        if (meta != null && Boolean.TRUE.equals(meta.get("zeroResult"))) return List.of();
        List<?> arr = list(resp, "alerts");
        List<WeatherBundle.Alert> out = new ArrayList<>();
        for (Object o : arr) {
            if (!(o instanceof Map<?, ?> m)) continue;
            Map<?, ?> et = map(m, "eventType");
            Map<?, ?> col = map(m, "color");
            out.add(new WeatherBundle.Alert(
                    str(m, "id"), str(m, "senderName"), str(m, "severity"),
                    et != null ? str(et, "name") : null,
                    str(m, "headline"), str(m, "description"),
                    str(m, "effectiveTime"), str(m, "expireTime"), str(m, "icon"),
                    col != null
                            ? new WeatherBundle.AlertColor(i(col, "red"), i(col, "green"), i(col, "blue"))
                            : null));
        }
        return out;
    }

    /** 城市搜索:code != 200 返回空列表。 */
    public static List<LocationCandidate> parseLocations(Map<?, ?> resp) {
        if (!"200".equals(str(resp, "code"))) return List.of();
        List<?> locs = list(resp, "location");
        List<LocationCandidate> out = new ArrayList<>();
        for (Object o : locs) {
            if (!(o instanceof Map<?, ?> m)) continue;
            out.add(new LocationCandidate(
                    str(m, "name"), str(m, "adm1"), str(m, "adm2"),
                    d(m, "lat"), d(m, "lon")));
        }
        return out;
    }

    // ── 内部 ────────────────────────────────────────────────────────────────

    /** 优先取和风通用 AQI(qaqi);否则取首个 index;空返回 null。 */
    private static Map<?, ?> pickIndex(List<?> indexes) {
        Map<?, ?> first = null;
        for (Object o : indexes) {
            if (!(o instanceof Map<?, ?> m)) continue;
            if (first == null) first = m;
            if ("qaqi".equals(str(m, "code"))) return m;
        }
        return first;
    }

    /** 从 pollutants[] 按 code 取浓度 value(so2 等可能缺失 → null)。 */
    private static Double pollutant(List<?> pollutants, String code) {
        for (Object o : pollutants) {
            if (!(o instanceof Map<?, ?> m)) continue;
            if (code.equals(str(m, "code"))) {
                Map<?, ?> c = map(m, "concentration");
                return c != null ? dOpt(c, "value") : null;
            }
        }
        return null;
    }

    private static String str(Map<?, ?> m, String k) {
        if (m == null) return null;
        Object v = m.get(k);
        return v == null ? null : v.toString();
    }

    private static int i(Map<?, ?> m, String k) {
        String s = str(m, k);
        if (s == null || s.isBlank()) return 0;
        try {
            return (int) Math.round(Double.parseDouble(s));
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    private static double d(Map<?, ?> m, String k) {
        String s = str(m, k);
        if (s == null || s.isBlank()) return 0;
        try {
            return Double.parseDouble(s);
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    private static Double dOpt(Map<?, ?> m, String k) {
        String s = str(m, k);
        if (s == null || s.isBlank()) return null;
        try {
            return Double.parseDouble(s);
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static Map<?, ?> map(Map<?, ?> m, String k) {
        if (m == null) return null;
        Object v = m.get(k);
        return v instanceof Map<?, ?> mm ? mm : null;
    }

    private static List<?> list(Map<?, ?> m, String k) {
        if (m == null) return List.of();
        Object v = m.get(k);
        return v instanceof List<?> l ? l : List.of();
    }
}
