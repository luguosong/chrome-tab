package com.personal.newtab.weather;

import lombok.extern.slf4j.Slf4j;
import org.springframework.web.client.RestClient;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 天气取数编排(见 ADR-0009)。三端点 per 位置:实况 /v7/weather/now、空气 v1 /airquality/v1/current、
 * 预警 v1 /weatheralert/v1/current。解析委托 {@link WeatherParser}(纯函数),本类只管 HTTP + 缓存 + 经纬度入参顺序。
 *
 * <p><b>经纬度入参顺序(和风反直觉点,极易错):</b>
 * <ul>
 *   <li>weather-now 的 location=lon,lat(<b>经度在前</b>,逗号分隔);</li>
 *   <li>v1 空气/预警路径 /{lat}/{lon}(<b>纬度在前</b>)。</li>
 * </ul>
 * 经纬度统一格式化 2 位小数(和风精度上限)。</p>
 *
 * <p>缓存:按 (canonicalKey, endpoint) 内存 TTL——实况 10min、空气 30min、预警 5min;仅缓存成功结果,
 * 失败不缓存(重试可再打上游)。降级:实况失败 → 整 bundle 为 null(前端该图标显示重试);
 * 空气/预警失败 → 各自 null/空,记 warn,不影响实况展示。</p>
 */
@Slf4j
public class WeatherService {

    private static final long NOW_TTL_MS = 10 * 60_000L;
    private static final long AIR_TTL_MS = 30 * 60_000L;
    private static final long ALERT_TTL_MS = 5 * 60_000L;

    private final RestClient http;
    private final WeatherProperties props;

    private final TtlCache<WeatherBundle.Now> nowCache = new TtlCache<>();
    private final TtlCache<WeatherBundle.Air> airCache = new TtlCache<>();
    private final TtlCache<List<WeatherBundle.Alert>> alertCache = new TtlCache<>();

    public WeatherService(RestClient http, WeatherProperties props) {
        this.http = http;
        this.props = props;
    }

    private void requireConfigured() {
        if (props.getApiKey() == null || props.getApiKey().isBlank()
                || props.getApiHost() == null || props.getApiHost().isBlank()) {
            throw new IllegalStateException("天气服务未配置(QWEATHER_API_KEY / newtab.weather.api-host 缺失)");
        }
    }

    /** 城市搜索(GeoAPI),供新增抽屉城市选择器消歧。 */
    public List<LocationCandidate> searchCities(String q) {
        requireConfigured();
        if (q == null || q.isBlank()) return List.of();
        Map<?, ?> resp = http.get()
                .uri(b -> b.path("/geo/v2/city/lookup")
                        .queryParam("location", q.trim())
                        .queryParam("lang", props.getLang())
                        .queryParam("number", 10)
                        .build())
                .header("X-QW-Api-Key", props.getApiKey())
                .retrieve().body(Map.class);
        return WeatherParser.parseLocations(resp);
    }

    /**
     * 取一个位置的三合一 bundle。实况失败返回 null(前端该图标重试);空气/预警各自降级。
     * canonicalKey = "lat,lon"(2 位小数),用作缓存键——不同原始串但同坐标共享缓存。
     */
    public WeatherBundle bundleFor(double lat, double lon) {
        requireConfigured();
        String canon = fmt(lat) + "," + fmt(lon);
        WeatherBundle.Now now;
        try {
            now = fetchNow(lat, lon, canon);
        } catch (Exception e) {
            log.warn("天气实况取数失败 {}: {}", canon, e.toString());
            return null;
        }
        WeatherBundle.Air air = null;
        try {
            air = fetchAir(lat, lon, canon);
        } catch (Exception e) {
            log.warn("空气质量取数失败 {}: {}", canon, e.toString());
        }
        List<WeatherBundle.Alert> alerts = List.of();
        try {
            alerts = fetchAlert(lat, lon, canon);
        } catch (Exception e) {
            log.warn("天气预警取数失败 {}: {}", canon, e.toString());
        }
        return new WeatherBundle(canon, now, air, alerts);
    }

    @SuppressWarnings("unchecked")
    private WeatherBundle.Now fetchNow(double lat, double lon, String canon) {
        WeatherBundle.Now cached = nowCache.get(canon);
        if (cached != null) return cached;
        String lon2 = fmt(lon), lat2 = fmt(lat);
        Map<String, Object> resp = http.get()
                .uri(b -> b.path("/v7/weather/now")
                        .queryParam("location", lon2 + "," + lat2)   // 经度在前
                        .queryParam("lang", props.getLang())
                        .queryParam("unit", "m")
                        .build())
                .header("X-QW-Api-Key", props.getApiKey())
                .retrieve().body(Map.class);
        WeatherBundle.Now v = WeatherParser.parseNow(resp);
        nowCache.put(canon, v, NOW_TTL_MS);
        return v;
    }

    @SuppressWarnings("unchecked")
    private WeatherBundle.Air fetchAir(double lat, double lon, String canon) {
        WeatherBundle.Air cached = airCache.get(canon);
        if (cached != null) return cached;
        String lat2 = fmt(lat), lon2 = fmt(lon);
        Map<String, Object> resp = http.get()
                .uri(b -> b.path("/airquality/v1/current/" + lat2 + "/" + lon2)   // 纬度在前
                        .queryParam("lang", props.getLang())
                        .build())
                .header("X-QW-Api-Key", props.getApiKey())
                .retrieve().body(Map.class);
        WeatherBundle.Air v = WeatherParser.parseAir(resp);
        airCache.put(canon, v, AIR_TTL_MS);
        return v;
    }

    @SuppressWarnings("unchecked")
    private List<WeatherBundle.Alert> fetchAlert(double lat, double lon, String canon) {
        List<WeatherBundle.Alert> cached = alertCache.get(canon);
        if (cached != null) return cached;
        String lat2 = fmt(lat), lon2 = fmt(lon);
        Map<String, Object> resp = http.get()
                .uri(b -> b.path("/weatheralert/v1/current/" + lat2 + "/" + lon2)   // 纬度在前
                        .queryParam("lang", props.getLang())
                        .build())
                .header("X-QW-Api-Key", props.getApiKey())
                .retrieve().body(Map.class);
        List<WeatherBundle.Alert> v = WeatherParser.parseAlerts(resp);
        alertCache.put(canon, new ArrayList<>(v), ALERT_TTL_MS);
        return v;
    }

    private static String fmt(double v) {
        return String.format(Locale.ROOT, "%.2f", v);
    }

    /** 简易 TTL 缓存:仅存成功结果,过期失效;重启清空可接受(分钟级数据,重拉无感)。 */
    private static final class TtlCache<V> {
        /** record 隐式静态,不能引用外层 TtlCache 的 V,故自带类型参数 T。 */
        private record Entry<T>(T value, long expiresAt) {}

        private final ConcurrentHashMap<String, Entry<V>> store = new ConcurrentHashMap<>();

        V get(String key) {
            Entry<V> e = store.get(key);
            if (e == null || e.expiresAt() < System.currentTimeMillis()) return null;
            return e.value();
        }

        void put(String key, V value, long ttlMillis) {
            store.put(key, new Entry<>(value, System.currentTimeMillis() + ttlMillis));
        }
    }
}
